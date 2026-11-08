from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from backend.ocr import extract_text

ROOT = Path(__file__).resolve().parents[1]
TEXT = "把生活写成诗\n认真记录每一天\nHELLO 2026"


def test_real_chinese_image_is_recognized():
    image = Image.new("RGB", (1000, 420), "white")
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 52)
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(TEXT.splitlines()):
        draw.text((70, 45 + i*110), line, fill="black", font=font)
    image.save(ROOT / "outputs" / "ocr-input.png")
    result = extract_text(image)
    assert "把生活写成诗" in result["text"]
    assert "认真记录每一天" in result["text"]
    assert "2026" in result["text"]
    assert len(result["lines"]) == 3
