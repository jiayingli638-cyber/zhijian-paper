"""Same text, actual original font/background, original presets and same integer seed.
Only the previous version's canvas limit is bypassed for this offline fair comparison.
The pre-fix implementation is a frozen diagnostic artifact, never used by the app.
"""
from pathlib import Path
import sys
import importlib.util
import json
import hashlib
from time import perf_counter
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops
from backend.renderer import RenderParams, render_pages, original_template, save_png
from backend.resources import PRESETS, resource_font
from handright import handwrite

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'outputs/handwriting-restore'


def main():
    text=(OUT/'comparison-text.txt').read_text(encoding='utf-8')
    preset=PRESETS['bg1']
    params=RenderParams(**preset,font_id='liguofu',background_id='bg1',seed=2026,aa=False,ink_filter=False)
    spec=importlib.util.spec_from_file_location('paperink_frozen_before',OUT/'renderer_before.py')
    before=importlib.util.module_from_spec(spec); sys.modules[spec.name]=before;spec.loader.exec_module(before)
    before.FONT=resource_font('liguofu')
    template=original_template(params)
    before._paper=lambda p:template.get_background().copy()
    old_params=before.RenderParams(width=preset['width'],height=preset['height'],font_size=100,line_spacing=143,margin=180,word_spacing=5,jitter=3,rotation=.05,seed=2026,aa=False,ink_filter=False)
    # Fairly supply the original's unequal margins and sigmas to the prior code too.
    # It ignores those fields; that is the layout symptom being demonstrated.
    before.RenderParams.validate=lambda p:None
    images=[]; timings=[]
    for fn in [lambda:before.render_pages(text,old_params)[0],lambda:list(handwrite(text,template,seed=2026))[0],lambda:render_pages(text,params)[0]]:
        start=perf_counter();images.append(fn());timings.append(round((perf_counter()-start)*1000))
    names=['before-same-resources.png','original-baseline.png','restored-same-resources.png']
    for name,image in zip(names,images):image.save(OUT/name)
    assert ImageChops.difference(images[1],images[2]).getbbox() is None
    changed_before=float(np.any(np.asarray(images[0])!=np.asarray(images[1]),axis=2).mean())
    # Side-by-side 800px pages and a 2x crop keep handwritten glyphs inspectable.
    label_font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',23)
    thumb_width=800; thumb_height=round(images[0].height*thumb_width/images[0].width)
    sheet=Image.new('RGB',(3*thumb_width+80,thumb_height+180),'#f5f6f8');d=ImageDraw.Draw(sheet)
    for i,(label,image) in enumerate(zip(['修改前（同字体背景）','原 Handright 5.5.0 基线','修正后（原逻辑）'],images)):
        x=20+i*(thumb_width+20);d.text((x,20),label,fill='#26313c',font=label_font)
        sheet.paste(image.resize((thumb_width,thumb_height),Image.Resampling.LANCZOS),(x,65))
    d.text((20,thumb_height+85),'同一段444字正文 · 李国夫手写体 · 原背景1 · 原字号100/行距143 · seed=2026',fill='#67727e',font=label_font)
    d.text((20,thumb_height+120),'修正后与同版本原逻辑基线：像素差为0（不含PNG元数据）',fill='#67727e',font=label_font)
    sheet.save(OUT/'同文字字体背景-三栏对照.png')
    box=(150,160,1450,650)
    crop=Image.new('RGB',(3*1300+80,550),'#f5f6f8');d=ImageDraw.Draw(crop)
    for i,(label,image) in enumerate(zip(['修改前','原逻辑基线','修正后'],images)):
        x=20+i*1320;d.text((x,8),label,fill='#26313c',font=label_font);crop.paste(image.crop(box),(x,50))
    crop.save(OUT/'同条件-笔迹局部对照.png')
    result={'text_chars':len(text),'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'font_id':'liguofu','font_sha256':hashlib.sha256(resource_font('liguofu').read_bytes()).hexdigest(),'background_id':'bg1','seed':2026,'preset':preset,'before_diff_pixels_ratio':changed_before,'restored_diff_pixels_ratio':0,'timings_ms':dict(zip(['before','original','restored'],timings)),'notes':'Baseline calls original Handright 5.5.0 source with Pillow metric compatibility adapter. Before canvas cap bypassed only for fair original-sized asset comparison; all prior drawing math remains unchanged.'}
    (OUT/'comparison-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
