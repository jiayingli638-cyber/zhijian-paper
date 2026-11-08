"""Local companion API: python -m backend.app. Public hosting needs TLS and access control."""
from pathlib import Path
from io import BytesIO
from time import perf_counter
from uuid import uuid4
from threading import BoundedSemaphore
import json
import re
import shutil
from dataclasses import asdict
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from .renderer import RenderParams, RenderError, iter_render_pages, save_png, font_path
from .ocr import extract_text
from .llm_service import analyze_ocr
from .resources import catalog, PRESETS, resource_background

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "outputs" / "tasks"
OUTPUT.mkdir(parents=True, exist_ok=True)
LIMIT = BoundedSemaphore(1)  # Large original paper jobs are serialized to bound memory.
LLM_LIMIT = BoundedSemaphore(1)  # Optional model calls are network-bound and must not block rendering.
app = FastAPI(title="纸间 PaperInk", version="1.0.0")


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=10000)
    paper: str = "ruled"
    width: int = 1240
    height: int = 1754
    font_size: int = 46
    line_spacing: int = 82
    margin: int = 98
    seed: int = 42
    aa: bool = False
    ink_filter: bool = False
    ink: str = "black"
    preview_chars: int | None = None
    font_id: str = "liguofu"
    background_id: str | None = None
    word_spacing: float = 3
    line_spacing_sigma: float = 0
    font_size_sigma: float | None = None
    word_spacing_sigma: float | None = None
    perturb_x_sigma: float | None = None
    perturb_y_sigma: float | None = None
    perturb_theta_sigma: float | None = None
    left_margin: float | None = None
    right_margin: float | None = None
    top_margin: float | None = None
    bottom_margin: float | None = None
    end_chars: str = "，。"


class OCRLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=2000)


class LLMProofreadOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str = Field(min_length=1, max_length=4096)
    model_name: str = Field(min_length=1, max_length=256)
    names: str = Field(default="", max_length=2000)
    lines: list[OCRLineInput] = Field(min_length=1, max_length=500)


@app.middleware("http")
async def local_browser_guard(request: Request, call_next):
    # No wildcard CORS; reject cross-site mutations (including simple multipart POST).
    origin = request.headers.get("origin")
    if request.method in {"POST", "DELETE", "PUT"} and origin:
        if origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"error": {"code": "ORIGIN_FORBIDDEN", "message": "不接受跨站请求"}}, status_code=403)
    return await call_next(request)


LLM_ERROR_STATUS = {
    "LLM_AUTH_FAILED": 401,
    "LLM_REQUEST_FAILED": 502,
    "LLM_UNREACHABLE": 502,
    "LLM_TIMEOUT": 504,
    "LLM_RESPONSE_INVALID": 502,
}


@app.exception_handler(RenderError)
async def error_handler(request, exc):
    status = 404 if exc.code == "FILE_NOT_FOUND" else 429 if exc.code == "BUSY" else LLM_ERROR_STATUS.get(exc.code, 400)
    return JSONResponse({"error": {"code": exc.code, "message": str(exc)}}, status_code=status)


@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    return JSONResponse({"error": {"code": "PROCESSING_FAILED", "message": "处理失败，请检查本机服务、字体资源或可用空间后重试"}}, status_code=500)


@app.get("/api/health")
def health():
    resources = catalog()
    return {"ready": any(font['available'] for font in resources['fonts']), "engine": "RapidOCR 3.10.0 / ONNX Runtime CPU", "renderer": "Original Handright 5.5.0", "original_resources_ready": all(item['available'] for item in resources['fonts'] if item['local_only']) and all(item['available'] for item in resources['backgrounds']), "storage": "local companion computer", "limits": {"upload_mb": 10, "text_chars": 10000, "output_pixels": 65400000}}


async def read_image(file):
    data = await file.read(10*1024*1024+1)
    if len(data) > 10*1024*1024:
        raise RenderError("UPLOAD_TOO_LARGE", "图片不能超过 10 MB")
    try:
        img = Image.open(BytesIO(data))
        if img.format not in {"PNG", "JPEG", "WEBP"}:
            raise RenderError("INVALID_IMAGE", "仅支持 PNG、JPG、WEBP 图片")
        if img.width * img.height > 20_000_000:
            raise RenderError("INVALID_IMAGE_SIZE", "图片不能超过 2000 万像素")
        img.load()
        return img
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise RenderError("INVALID_IMAGE", "图片无效或已损坏，请重新选择")


def guarded(fn, *args):
    if not LIMIT.acquire(blocking=False):
        raise RenderError("BUSY", "服务繁忙，请稍后重试")
    try:
        return fn(*args)
    finally:
        LIMIT.release()


def guarded_llm(fn, *args):
    if not LLM_LIMIT.acquire(blocking=False):
        raise RenderError("BUSY", "已有大模型校对正在进行，请稍后重试")
    try:
        return fn(*args)
    finally:
        LLM_LIMIT.release()


@app.post("/api/ocr")
async def ocr(file: UploadFile = File(...)):
    image = await read_image(file)
    return await run_in_threadpool(guarded, extract_text, image)


def generate(request):
    started = perf_counter()
    values = request.model_dump(exclude={"text", "preview_chars"})
    if request.background_id:
        if request.background_id not in PRESETS:
            raise RenderError("INVALID_BACKGROUND", "未知原背景选项")
        preset = PRESETS[request.background_id]
        values.update({key: value for key, value in preset.items() if key not in request.model_fields_set})
        # The image is never resized to make custom dimensions fit silently.
        values['width'], values['height'] = preset['width'], preset['height']
    params = RenderParams(**values)
    images = iter_render_pages(request.text, params, preview_chars=request.preview_chars)
    task_id = uuid4().hex
    dest = OUTPUT / task_id
    dest.mkdir(exist_ok=False)
    try:
        paths = []
        for i, image in enumerate(images, 1):
            filename = f"page-{i:03d}.png"
            save_png(image, dest/filename, params)
            image.close()
            paths.append(f"/api/files/{task_id}/{filename}")
        info = {"task_id": task_id, "page_count": len(paths), "pages": paths, "elapsed_ms": round((perf_counter()-started)*1000), "params": asdict(params)}
        (dest/"manifest.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        # OCR input never stored; manifests omit original and corrected private text.
        return info
    except Exception:
        shutil.rmtree(dest)
        raise


@app.post("/api/render")
async def render(request: RenderRequest):
    return await run_in_threadpool(guarded, generate, request)


@app.post("/api/llm/proofread")
async def llm_proofread(file: UploadFile = File(...), options: str = Form(...)):
    image = await read_image(file)
    try:
        payload = json.loads(options)
        request = LLMProofreadOptions(**payload)
    except Exception:
        raise RenderError("INVALID_PARAMS", "大模型校对参数无效：请填写 base_url、api_key、model_name，并保留 OCR 行")
    return await run_in_threadpool(
        guarded_llm, analyze_ocr,
        image, [line.text for line in request.lines],
        request.base_url, request.api_key, request.model_name, request.names,
    )


@app.post("/api/workflow")
async def workflow(file: UploadFile = File(...), options: str = Form("{}")):
    image = await read_image(file)
    try:
        opts = json.loads(options)
        if not isinstance(opts, dict) or "text" in opts:
            raise ValueError()
        request = RenderRequest(text="temporary", **opts)
    except Exception:
        raise RenderError("INVALID_PARAMS", "工作流参数 JSON 无效")
    def process():
        recognized = extract_text(image)
        request.text = recognized["text"]
        rendered = generate(request)
        return {"ocr": recognized, "render": rendered, "review_required": True}
    return await run_in_threadpool(guarded, process)


def valid_task(task_id):
    if not re.fullmatch(r"[a-f0-9]{32}", task_id):
        raise RenderError("FILE_NOT_FOUND", "文件不存在或已清理")
    return OUTPUT/task_id


@app.get("/api/files/{task_id}/{filename}")
def output_file(task_id: str, filename: str):
    directory = valid_task(task_id)
    if not re.fullmatch(r"page-\d{3}\.png", filename) or not (directory/filename).is_file():
        raise RenderError("FILE_NOT_FOUND", "文件不存在或已清理")
    return FileResponse(directory/filename, media_type="image/png")


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str):
    directory = valid_task(task_id)
    if directory.exists():
        shutil.rmtree(directory)
    return {"deleted": True}


@app.get("/api/resources")
def get_resources():
    return catalog()


@app.get("/api/resources/backgrounds/{background_id}/thumbnail.png")
def background_thumbnail(background_id: str):
    if background_id not in PRESETS:
        raise RenderError('FILE_NOT_FOUND', '背景不存在')
    path = resource_background(background_id)
    if not path.is_file():
        raise RenderError('BACKGROUND_MISSING', '原背景文件不存在')
    with Image.open(path) as image:
        image.thumbnail((420,560))
        stream = BytesIO()
        image.convert('RGB').save(stream, format='PNG')
    from fastapi.responses import Response
    return Response(stream.getvalue(), media_type='image/png')


@app.get("/api/sample")
def sample():
    path = ROOT/"outputs/ocr-input.png"
    if not path.is_file():
        raise RenderError("FILE_NOT_FOUND", "示例图片尚未准备，请先运行自测")
    return FileResponse(path, media_type="image/png")


@app.get("/")
def home():
    # Revalidate every load so a refreshed page never mixes new HTML with stale JS.
    return FileResponse(ROOT/"web/index.html", headers={"Cache-Control": "no-cache"})


class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/web", NoCacheStaticFiles(directory=ROOT/"web"), name="web")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
