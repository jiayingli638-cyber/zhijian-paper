"""Reproducible bounded measurement; not a general OCR accuracy benchmark."""
from pathlib import Path
import json
import hashlib
from time import perf_counter
from PIL import Image, ImageDraw, ImageFont
from backend.ocr import extract_text
from backend.renderer import render_pages, RenderParams
ROOT = Path(__file__).resolve().parents[1]

def main():
    truth = "把生活写成诗\n认真记录每一天\nHELLO 2026"
    with Image.open(ROOT/"outputs/ocr-input.png") as image:
        cold_start = perf_counter(); cold = extract_text(image); cold_ms = round((perf_counter()-cold_start)*1000)
        hot = extract_text(image)
    start = perf_counter(); pages = render_pages(hot["text"], RenderParams(seed=2026)); rendering_ms = round((perf_counter()-start)*1000)
    neat = Image.new("RGB", (1000, 420), "white")
    d = ImageDraw.Draw(neat)
    font = ImageFont.truetype(str(ROOT/"backend/assets/LXGWWenKai-Regular.ttf"), 54)
    for i, line in enumerate(truth.splitlines()): d.text((70,45+i*110),line,font=font,fill="black")
    neat.save(ROOT/"outputs/ocr-wenkai-input.png")
    wenkai = extract_text(neat)
    clean=lambda s: ''.join(s.split())
    result = {"sample_kind":"synthetic 3-line print and WenKai font samples; not human handwriting", "truth":truth,"print_recognized":cold["text"],"print_exact_match":clean(truth)==clean(cold["text"]),"print_lines":len(cold["lines"]),"print_line_scores":[x["score"] for x in cold["lines"]],"cold_total_ms":cold_ms,"warm_ocr_ms":hot["elapsed_ms"],"render_ms":rendering_ms,"output_size":list(pages[0].size),"output_pages":len(pages),"wenkai_recognized":wenkai["text"],"wenkai_exact_match":clean(truth)==clean(wenkai["text"]),"font_sha256":hashlib.sha256((ROOT/"backend/assets/LXGWWenKai-Regular.ttf").read_bytes()).hexdigest()}
    (ROOT/"outputs/measurement.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":main()
