import io
from PIL import Image
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_render_endpoint_returns_downloadable_png():
    r = client.post("/api/render", json={"text": "让文字留在纸上。", "seed": 42})
    assert r.status_code == 200
    result = r.json()
    assert result["page_count"] == 1
    download = client.get(result["pages"][0])
    assert download.status_code == 200
    assert Image.open(io.BytesIO(download.content)).size == (1240, 1754)


def test_real_image_to_ocr_to_handwriting_workflow():
    from pathlib import Path
    source = Path(__file__).resolve().parents[1]/"outputs/ocr-input.png"
    r = client.post("/api/workflow", files={"file": ("sample.png", source.read_bytes(), "image/png")}, data={"options": '{"seed":2026}'})
    assert r.status_code == 200
    result = r.json()
    assert "把生活写成诗" in result["ocr"]["text"]
    assert result["render"]["params"]["seed"] == 2026
    png = client.get(result["render"]["pages"][0])
    assert png.status_code == 200
    image = Image.open(io.BytesIO(png.content))
    assert image.info["Seed"] == "2026"
    assert "AI-generated" in image.info["Description"]
    image.save(source.parent/"workflow-handwriting.png")


def test_no_overwrite_and_safe_file_access():
    a = client.post("/api/render", json={"text":"第一份作品"}).json()
    b = client.post("/api/render", json={"text":"第一份作品"}).json()
    assert a["task_id"] != b["task_id"]
    assert client.get(a["pages"][0]).content == client.get(b["pages"][0]).content
    assert client.get("/api/files/not-a-task/page-001.png").status_code == 404
    assert client.delete("/api/tasks/"+a["task_id"]).status_code == 200
    assert client.get(a["pages"][0]).status_code == 404


def test_bad_images_empty_results_and_parameters_are_visible_errors():
    assert client.post("/api/ocr", files={"file":("bad.png",b"not an image","image/png")}).json()["error"]["code"] == "INVALID_IMAGE"
    buffer = io.BytesIO(); Image.new("RGB", (800, 600), "white").save(buffer, format="PNG")
    response = client.post("/api/ocr", files={"file":("blank.png",buffer.getvalue(),"image/png")})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NO_TEXT"
    assert client.post("/api/render", json={"text":" "}).status_code == 400
    assert client.post("/api/render", json={"text":"字", "font_size":100,"line_spacing":40}).status_code == 400
    assert client.post("/api/render", json={"text":"字", "font_path":"/secret"}).status_code == 422


def test_original_font_catalog_backgrounds_and_real_generated_resources():
    from pathlib import Path
    import json
    from time import perf_counter
    from backend.resources import PRESETS
    resources = client.get('/api/resources').json()
    assert [font['id'] for font in resources['fonts'][:4]] == ['liguofu','yiqi','qingye','yunyan']
    assert all(item['available'] for item in resources['fonts'] + resources['backgrounds'])
    measurements=[]
    for font_id, background_id in [('liguofu','bg1'),('yiqi','bg1'),('qingye','bg1'),('yunyan','bg1'),('liguofu','bg2'),('liguofu','bg3')]:
        started=perf_counter()
        response=client.post('/api/render', json={'text':'　　同一文字与原纸张。\n保留原手写排版。','font_id':font_id,'background_id':background_id,'seed':2026})
        assert response.status_code==200, response.text
        result=response.json()
        for key,value in PRESETS[background_id].items(): assert result['params'][key]==value
        png=client.get(result['pages'][0]); image=Image.open(io.BytesIO(png.content)); image.load()
        assert image.size==(PRESETS[background_id]['width'],PRESETS[background_id]['height'])
        assert image.info['Font']==font_id and image.info['Background']==background_id
        assert image.info['Software']=='PaperInk / original Handright 5.5.0'
        assert not result['params']['aa'] and not result['params']['ink_filter']
        measurements.append({'font':font_id,'background':background_id,'dimensions':image.size,'elapsed_ms':round((perf_counter()-started)*1000),'png_bytes':len(png.content)})
        image.close()
    for background in resources['backgrounds']:
        response=client.get(background['thumbnail']); assert response.status_code==200
        image=Image.open(io.BytesIO(response.content)); assert image.width<=420 and image.height<=560
    Path('outputs/handwriting-restore/resource-tests.json').write_text(json.dumps(measurements,ensure_ascii=False,indent=2),encoding='utf-8')


def test_missing_original_resources_are_errors_not_fallbacks(monkeypatch, tmp_path):
    monkeypatch.setenv('PAPERINK_RESOURCE_DIR', str(tmp_path))
    resources=client.get('/api/resources').json()
    assert all(not font['available'] for font in resources['fonts'] if font['local_only'])
    font_error=client.post('/api/render',json={'text':'文字','font_id':'liguofu','background_id':'bg1'})
    assert font_error.status_code==400 and font_error.json()['error']['code']=='FONT_MISSING'
    background_error=client.post('/api/render',json={'text':'文字','font_id':'wenkai','background_id':'bg1'})
    assert background_error.status_code==400 and background_error.json()['error']['code']=='BACKGROUND_MISSING'
    assert client.post('/api/render',json={'text':'文字','font_id':'unknown'}).json()['error']['code']=='INVALID_FONT'


def test_local_service_rejects_cross_site_mutation():
    assert client.post("/api/render", json={"text":"文字"}, headers={"Origin":"https://foreign.example"}).status_code == 403
