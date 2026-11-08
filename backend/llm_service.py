"""Business layer: prompt building, LLM proofreading and cross-validation.

The model is never trusted blindly. Every proposed line is checked against the
OCR original (minimal edit, math symbols, English words and protected names)
before it can take part in the cross-validation result.
"""
from __future__ import annotations

import base64
import io
import json
import re
from time import perf_counter

from PIL import Image, ImageOps

from .llm_client import OpenAICompatibleClient, parse_model_json
from .renderer import RenderError

MAX_IMAGE_SIDE = 2048
MAX_NAMES = 20
NAME_CONTEXT = 2
MATH_CHARS = set("0123456789+-−×÷*/=≈≠<>≤≥±√^%‰∞∑∏∫°′″∈∉⊂⊃∪∩π")
ENGLISH_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def normalize_names(value) -> list[str]:
    if isinstance(value, list):
        parts = value
    else:
        parts = re.split(r"[,，、;；\n]+", str(value or ""))
    names = []
    for part in parts:
        name = str(part).strip()
        if name and name not in names:
            names.append(name)
    if len(names) > MAX_NAMES:
        raise RenderError("LLM_CONFIG_INVALID", f"名字最多支持 {MAX_NAMES} 个，请用逗号分隔")
    if any(len(name) > 64 for name in names):
        raise RenderError("LLM_CONFIG_INVALID", "单个名字不能超过 64 个字符")
    return names


def _name_rule(names: list[str], independent: bool = False) -> str:
    if not names:
        return "没有指定受保护名字；仍须保持所有人名、专有名词逐字不变。"
    joined = "、".join(f"「{name}」" for name in names)
    verb = "逐字识别并输出" if independent else "逐字保持原样"
    return (
        f"以下名字是受保护文本：{joined}。这些名字及其前后各 {NAME_CONTEXT} 个字符必须{verb}，"
        "不得改写、不得增删或替换标点、不得换字、不得移动位置。"
    )


def proofread_system_prompt(names: list[str]) -> str:
    return (
        "你是严谨的中文与数学文字校对助手。你只做逐行、极小范围的校对。\n"
        "必须遵守：\n"
        "1. 逐行处理，只允许单字级别的增、删、改；不得改写句子、不得调整语序、不得合并或拆分行。\n"
        "2. 改写后语义必须与原文完全一致。\n"
        "3. 数学符号、数字、公式结构与运算符不可更改（如 + - × ÷ = ≠ ≈ < > ≤ ≥ ± √ ∑ ∫ π 等）。\n"
        "4. 英文单词不可改写、不可翻译、不可增删字母，大小写必须保持不变。\n"
        f"5. {_name_rule(names)}\n"
        "只输出 JSON，不要 Markdown 代码块，不要解释。格式："
        '{"lines":[{"index":0,"text":"校对后的整行文字"}]}。\n'
        "lines 的数量与 index 顺序必须与输入完全一致；每项 text 是一整行，不能包含换行。"
    )


def recheck_system_prompt(names: list[str]) -> str:
    return (
        "你是独立的 OCR 引擎。请直接阅读用户提供的图片，逐行重新识别其中的文字与数学符号，"
        "不要参考其他识别结果。\n"
        "必须遵守：\n"
        "1. 按图片中的实际阅读顺序输出，一行一项。\n"
        "2. 数学符号必须原样输出，不要转换成文字、不要解释。\n"
        "3. 英文单词保持原拼写与大小写。\n"
        "4. 不要翻译、不要补全、不要删减、不要总结。\n"
        f"5. {_name_rule(names, independent=True)}\n"
        "只输出 JSON，不要 Markdown 代码块，不要解释。格式："
        '{"lines":[{"text":"识别到的整行文字"}]}。'
    )


def _extract_lines(data, indexed: bool) -> list:
    if isinstance(data, dict):
        items = data.get("lines")
    elif isinstance(data, list):
        items = data
    else:
        items = None
    if not isinstance(items, list):
        raise RenderError("LLM_RESPONSE_INVALID", "大模型返回的 JSON 缺少 lines 数组")
    result = []
    for position, item in enumerate(items):
        if isinstance(item, str):
            result.append((position, item))
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            index = item.get("index", position) if indexed else position
            if isinstance(index, bool) or not isinstance(index, int):
                index = position
            result.append((index, item["text"]))
    return result


def proofread_lines(client: OpenAICompatibleClient, lines: list[str], names: list[str]) -> list[dict]:
    payload = json.dumps({"lines": [{"index": index, "text": text} for index, text in enumerate(lines)]}, ensure_ascii=False)
    messages = [
        {"role": "system", "content": proofread_system_prompt(names)},
        {"role": "user", "content": payload},
    ]
    received = {}
    for index, text in _extract_lines(parse_model_json(client.chat(messages)), indexed=True):
        if 0 <= index < len(lines):
            received[index] = text
    results = []
    for index, original in enumerate(lines):
        if index not in received:
            results.append(_reverted(index, original, "模型未返回该行，已保留 OCR 原文"))
            continue
        revised, status, notes = guard_line(original, received[index], names)
        results.append({"index": index, "original": original, "revised": revised, "status": status, "notes": notes})
    return results


def _reverted(index: int, original: str, note: str) -> dict:
    return {"index": index, "original": original, "revised": original, "status": "reverted", "notes": [note]}


def guard_line(original: str, revised: str, names: list[str]) -> tuple[str, str, list[str]]:
    if not isinstance(revised, str) or "\n" in revised or "\r" in revised:
        return original, "reverted", ["模型给单行返回了多行文本，已回退 OCR 原文"]
    if revised == original:
        return original, "unchanged", []
    if _levenshtein(original, revised) > _edit_limit(original):
        return original, "reverted", ["改动超出单字级最小范围，已回退 OCR 原文"]
    if _math_signature(original) != _math_signature(revised):
        return original, "reverted", ["数学符号或数字被改动，已回退 OCR 原文"]
    if ENGLISH_WORD.findall(original) != ENGLISH_WORD.findall(revised):
        return original, "reverted", ["英文单词被改动，已回退 OCR 原文"]
    problem = _name_problem(original, revised, names)
    if problem:
        return original, "reverted", [problem]
    return revised, "accepted", []


def _edit_limit(text: str) -> int:
    return max(2, min(3, len(text) // 12))


def _levenshtein(first: str, second: str) -> int:
    if first == second:
        return 0
    if not first or not second:
        return len(first) or len(second)
    previous = list(range(len(second) + 1))
    for i, left in enumerate(first, 1):
        current = [i]
        for j, right in enumerate(second, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def _math_signature(text: str) -> str:
    return "".join(character for character in text if character in MATH_CHARS)


def _name_problem(original: str, revised: str, names: list[str]) -> str:
    for name in names:
        original_positions = [match.start() for match in re.finditer(re.escape(name), original)]
        revised_positions = [match.start() for match in re.finditer(re.escape(name), revised)]
        if len(original_positions) != len(revised_positions):
            return f"受保护名字「{name}」的出现次数被改动，已回退 OCR 原文"
        for original_position, revised_position in zip(original_positions, revised_positions):
            original_context = original[
                max(0, original_position - NAME_CONTEXT): original_position + len(name) + NAME_CONTEXT
            ]
            revised_context = revised[
                max(0, revised_position - NAME_CONTEXT): revised_position + len(name) + NAME_CONTEXT
            ]
            if original_context != revised_context:
                return f"受保护名字「{name}」邻近文字被改动，已回退 OCR 原文"
    return ""


def image_data_url(image: Image.Image) -> str:
    prepared = ImageOps.exif_transpose(image).convert("RGB")
    if max(prepared.size) > MAX_IMAGE_SIDE:
        prepared.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    prepared.save(buffer, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def recheck_image(client: OpenAICompatibleClient, image: Image.Image, names: list[str]) -> list[str]:
    messages = [
        {"role": "system", "content": recheck_system_prompt(names)},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请重新识别这张图片中的全部文字与数学符号，按行输出 JSON。"},
                {"type": "image_url", "image_url": {"url": image_data_url(image)}},
            ],
        },
    ]
    lines = [text for _, text in _extract_lines(parse_model_json(client.chat(messages)), indexed=False)]
    if not any(text.strip() for text in lines):
        raise RenderError("LLM_RESPONSE_INVALID", "大模型重识别没有返回任何文字")
    return lines


def cross_validate(original_lines: list[str], proofread: list[dict], recognized: list[str]) -> dict:
    rows = []
    for index, original in enumerate(original_lines):
        item = proofread[index]
        proposed = item["revised"]
        recognized_line = recognized[index] if index < len(recognized) else None
        if item["status"] == "reverted":
            adopted, status = original, "reverted"
            note = "；".join(item.get("notes") or []) or "校对结果未通过保护校验，已回退 OCR 原文"
        elif recognized_line is None:
            adopted, status = original, "recheck_missing"
            note = "独立重识别未返回该行；保留 OCR 原文"
        elif recognized_line == proposed:
            if proposed == original:
                adopted, status, note = original, "unchanged", "OCR、校对与重识别一致"
            else:
                adopted, status, note = proposed, "cross_agree", "校对与独立重识别一致"
        elif proposed == original:
            adopted, status, note = original, "recheck_diff", "校对未改动；重识别与 OCR 不同，保留 OCR 原文"
        else:
            adopted, status = original, "conflict"
            note = "校对改动未被重识别确认；保留 OCR 原文，请人工确认"
        rows.append({
            "line": index + 1,
            "ocr": original,
            "proofread": proposed,
            "recognized": recognized_line,
            "adopted": adopted,
            "status": status,
            "note": note,
            "changed": adopted != original,
        })
    extra = recognized[len(original_lines):]
    line_count_match = len(recognized) == len(original_lines)
    needs_review = (
        not line_count_match
        or any(row["status"] in {"conflict", "recheck_diff", "reverted", "recheck_missing"} for row in rows)
    )
    return {
        "lines": rows,
        "final_text": "\n".join(row["adopted"] for row in rows),
        "line_count_match": line_count_match,
        "extra_recognized_lines": extra,
        "changed_lines": sum(1 for row in rows if row["changed"]),
        "conflict_lines": sum(1 for row in rows if row["status"] in {"conflict", "recheck_diff"}),
        "reverted_lines": sum(1 for row in rows if row["status"] == "reverted"),
        "needs_review": needs_review,
    }


def analyze_ocr(image: Image.Image, lines: list[str], base_url: str, api_key: str, model_name: str, names_value: str) -> dict:
    started = perf_counter()
    names = normalize_names(names_value)
    if not lines:
        raise RenderError("INVALID_PARAMS", "没有可校对的 OCR 行")
    client = OpenAICompatibleClient(base_url, api_key, model_name)
    try:
        proofread = proofread_lines(client, lines, names)
    except RenderError as error:
        raise RenderError(error.code, "文字校对失败：" + str(error))
    try:
        recognized = recheck_image(client, image, names)
    except RenderError as error:
        raise RenderError(error.code, "独立重识别失败：" + str(error))
    validation = cross_validate(lines, proofread, recognized)
    return {
        "enabled": True,
        "engine": "OpenAI-compatible chat/completions",
        "model": client.model,
        "names": names,
        "original": {"text": "\n".join(lines), "lines": lines},
        "proofread": {"lines": proofread},
        "recognized": {"text": "\n".join(recognized), "lines": recognized},
        "cross_validation": validation,
        "final_text": validation["final_text"],
        "needs_review": validation["needs_review"],
        "elapsed_ms": round((perf_counter() - started) * 1000),
    }
