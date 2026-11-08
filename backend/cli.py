"""CLI replacement for the recovered GUI's rendering path.
python -m backend.cli --text-file note.txt --output ./outputs
python -m backend.cli --image photo.png --output ./outputs
"""
import argparse
import json
from pathlib import Path
from PIL import Image
from .renderer import RenderParams, iter_render_pages, save_png, RenderError
from .ocr import extract_text
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description="本地图片识字与手写风格排版")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text-file", type=Path)
    source.add_argument("--image", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--paper", choices=["plain", "ruled", "grid"], default="ruled")
    parser.add_argument("--font", choices=["liguofu", "yiqi", "qingye", "yunyan", "wenkai"], default="liguofu")
    parser.add_argument("--background", choices=["bg1", "bg2", "bg3", "none"], default="bg1")
    parser.add_argument("--smooth", action="store_true", help="可选轻边缘后处理，默认保持原笔画")
    parser.add_argument("--filter", action="store_true", help="可选轻墨迹后处理")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--preview-chars", type=int)
    parser.add_argument("--no-aa", action="store_true")
    parser.add_argument("--no-filter", action="store_true")
    args = parser.parse_args()
    try:
        if args.image:
            with Image.open(args.image) as image:
                result = extract_text(image)
                text = result["text"]
                print(json.dumps({"recognized_text": text, "review_required": True}, ensure_ascii=False))
        else:
            text = args.text_file.read_text(encoding="utf-8-sig")
        from .resources import PRESETS
        values = dict(paper=args.paper, font_id=args.font, seed=args.seed, aa=args.smooth and not args.no_aa, ink_filter=args.filter and not args.no_filter)
        if args.background != "none":
            values.update(PRESETS[args.background], background_id=args.background)
        params = RenderParams(**values)
        pages = iter_render_pages(text, params, preview_chars=args.preview_chars)
        destination = args.output.resolve()/uuid4().hex
        destination.mkdir(parents=True, exist_ok=False)
        count = 0
        try:
            for i, image in enumerate(pages, 1):
                save_png(image, destination/f"page-{i:03d}.png", params)
                image.close()
                count = i
        except Exception:
            import shutil
            shutil.rmtree(destination)
            raise
        print(json.dumps({"pages": count, "directory": str(destination)}, ensure_ascii=False))
    except (RenderError, OSError) as error:
        parser.exit(1, str(error)+"\n")

if __name__ == "__main__":
    main()
