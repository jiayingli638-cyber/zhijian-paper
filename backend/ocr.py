"""CPU OCR adapter. Image bytes stay on the user's companion computer."""
from functools import lru_cache
from threading import Lock
from time import perf_counter
from PIL import Image, ImageOps
from rapidocr import RapidOCR
from .renderer import RenderError

LOCK = Lock()


@lru_cache(maxsize=1)
def engine():
    return RapidOCR(params={
        "EngineConfig.onnxruntime.intra_op_num_threads": 4,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })


def extract_text(image: Image.Image):
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    if width * height > 20_000_000 or min(width, height) < 24:
        raise RenderError("INVALID_IMAGE_SIZE", "图片需大于 24 像素，且不超过 2000 万像素")
    start = perf_counter()
    with LOCK:
        output = engine()(image)
    lines = []
    if output.txts and output.boxes is not None:
        for text, score, box in zip(output.txts, output.scores, output.boxes):
            lines.append({"text": text, "score": round(float(score), 4), "box": box.tolist()})
    if not lines:
        raise RenderError("NO_TEXT", "没有识别到文字，请使用清晰、正向、光线均匀的图片，或手动输入")
    return {
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines, "width": width, "height": height,
        "engine": "RapidOCR 3.10.0 / ONNX Runtime CPU", "elapsed_ms": round((perf_counter()-start)*1000),
        "needs_review": any(line["score"] < 0.85 for line in lines),
    }
