"""OpenAI-compatible chat/completions access layer.

Only the local backend talks to the configured provider. This module never
persists the API key and never includes it in error messages.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

import httpx

from .renderer import RenderError

DEFAULT_TIMEOUT = 120.0


def normalize_base_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        raise RenderError("LLM_CONFIG_INVALID", "请填写大模型接口地址 base_url")
    if not re.match(r"^https?://", raw, re.I):
        raise RenderError("LLM_CONFIG_INVALID", "base_url 需以 http:// 或 https:// 开头")
    parts = urlsplit(raw)
    if not parts.hostname:
        raise RenderError("LLM_CONFIG_INVALID", "base_url 缺少有效主机名")
    if parts.query or parts.fragment:
        raise RenderError("LLM_CONFIG_INVALID", "base_url 不能包含查询参数或锚点")
    return raw.rstrip("/")


def candidate_urls(base_url: str) -> list[str]:
    """Accept base_url with or without /v1, or a full /chat/completions path."""
    if base_url.endswith("/chat/completions"):
        return [base_url]
    if re.search(r"/v\d+$", base_url, re.I):
        return [base_url + "/chat/completions"]
    return [base_url + "/v1/chat/completions", base_url + "/chat/completions"]


class OpenAICompatibleClient:
    def __init__(self, base_url: str, api_key: str, model_name: str, timeout: float = DEFAULT_TIMEOUT):
        self.base_url = normalize_base_url(base_url)
        self.api_key = (api_key or "").strip()
        self.model = (model_name or "").strip()
        self.timeout = timeout
        if not self.api_key:
            raise RenderError("LLM_CONFIG_INVALID", "请填写 api_key")
        if not self.model:
            raise RenderError("LLM_CONFIG_INVALID", "请填写模型名称 model_name")

    def chat(self, messages):
        payload = {"model": self.model, "messages": messages, "temperature": 0}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        urls = candidate_urls(self.base_url)
        with httpx.Client(timeout=httpx.Timeout(self.timeout, connect=15.0)) as client:
            for index, url in enumerate(urls):
                try:
                    response = client.post(url, json=payload, headers=headers)
                except httpx.TimeoutException:
                    raise RenderError("LLM_TIMEOUT", "大模型接口响应超时，请检查网络或稍后重试")
                except httpx.HTTPError as error:
                    if index + 1 < len(urls):
                        continue
                    raise RenderError("LLM_UNREACHABLE", f"无法连接大模型接口（{type(error).__name__}），请检查 base_url 与网络")
                if response.status_code in (401, 403):
                    raise RenderError("LLM_AUTH_FAILED", "大模型接口鉴权失败，请检查 api_key 是否有权访问该模型")
                if response.status_code == 404 and index + 1 < len(urls):
                    continue
                if response.status_code >= 400:
                    detail = _error_detail(response)
                    if self.api_key:
                        detail = detail.replace(self.api_key, "***")
                    raise RenderError(
                        "LLM_REQUEST_FAILED",
                        f"大模型接口返回 HTTP {response.status_code}{detail}",
                    )
                return _response_content(response)
        raise RenderError("LLM_UNREACHABLE", "无法连接大模型接口，请检查 base_url、网络或服务是否可用")


def _error_detail(response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if isinstance(error, dict):
        message = error.get("message")
    elif isinstance(error, str):
        message = error
    else:
        message = body.get("message")
    if isinstance(message, str) and message.strip():
        return "：" + re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", message.strip()[:300])
    return ""


def _response_content(response) -> str:
    try:
        body = response.json()
    except ValueError:
        raise RenderError("LLM_RESPONSE_INVALID", "大模型返回的内容不是有效 JSON")
    choices = body.get("choices") if isinstance(body, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RenderError("LLM_RESPONSE_INVALID", "大模型响应缺少 choices，请检查接口是否为 chat/completions 兼容格式")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        raise RenderError("LLM_RESPONSE_INVALID", "大模型没有返回可用文本，请检查模型名称与接口兼容性")
    return content


def parse_model_json(text: str):
    """Parse JSON even when a compatible model wraps it in a code fence."""
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    candidates = [cleaned]
    starts = [(cleaned.find("{"), cleaned.rfind("}")), (cleaned.find("["), cleaned.rfind("]"))]
    for start, end in starts:
        if start >= 0 and end > start:
            candidates.append(cleaned[start:end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise RenderError("LLM_RESPONSE_INVALID", "大模型返回格式无法解析为 JSON，请换用兼容 chat/completions 的模型")
