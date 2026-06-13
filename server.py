from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATABASE_PATH = DATA_DIR / "wardrobe.json"
DEFAULT_BASE_URL = "https://ai-us.hctopup.com/v1"
DEFAULT_MODEL = "gpt-5.5"
DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_REASONING_EFFORT = "xhigh"
RUNTIME_API_KEY = ""
SECRET_FIELD_NAMES = {
    "apikey",
    "api_key",
    "openaiapikey",
    "openai_api_key",
    "authorization",
    "bearer",
    "secret",
    "password",
    "token",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "refresh_token",
}


class ProviderError(RuntimeError):
    def __init__(self, status: int | None, message: str, details: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.details = details


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def env_flag(name: str, default: bool = False) -> bool:
    value = env(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def server_database_enabled() -> bool:
    return not env_flag("DISABLE_SERVER_DATABASE")


def runtime_api_key_enabled() -> bool:
    return not env_flag("DISABLE_RUNTIME_API_KEY")


def provider_config() -> dict[str, str]:
    return {
        "base_url": env("OPENAI_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "model": env("OPENAI_MODEL", DEFAULT_MODEL),
        "image_model": env("OPENAI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL),
        "reasoning_effort": env("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT),
    }


def api_key() -> str:
    return RUNTIME_API_KEY or env("OPENAI_API_KEY")


def api_key_source() -> str:
    if RUNTIME_API_KEY:
        return "runtime"
    if env("OPENAI_API_KEY"):
        return "environment"
    return "none"


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def is_secret_field(name: Any) -> bool:
    normalized = re.sub(r"[^a-z0-9_]", "", str(name).lower())
    collapsed = normalized.replace("_", "")
    return normalized in SECRET_FIELD_NAMES or collapsed in SECRET_FIELD_NAMES


def strip_secret_fields(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): strip_secret_fields(item)
            for key, item in value.items()
            if not is_secret_field(key)
        }
    if isinstance(value, list):
        return [strip_secret_fields(item) for item in value]
    return value


def read_database_file() -> dict[str, Any] | None:
    if not DATABASE_PATH.exists():
        return None
    with DATABASE_PATH.open("r", encoding="utf-8") as file:
        value = json.load(file)
    if not isinstance(value, dict):
        raise RuntimeError("Local wardrobe database is not a JSON object.")
    return strip_secret_fields(value)


def database_from_request(request: dict[str, Any]) -> dict[str, Any]:
    database = request.get("database", request)
    if not isinstance(database, dict):
        raise RuntimeError("Missing wardrobe database.")
    return strip_secret_fields(database)


def save_database_file(database: dict[str, Any]) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_database = strip_secret_fields(database)
    text = json.dumps(safe_database, ensure_ascii=False, indent=2)
    DATABASE_PATH.write_text(text, encoding="utf-8")
    return DATABASE_PATH.stat().st_size


def delete_database_file() -> bool:
    if not DATABASE_PATH.exists():
        return False
    DATABASE_PATH.unlink()
    return True


def make_response_request(payload: dict[str, Any]) -> dict[str, Any]:
    key = api_key()
    if not key:
        raise RuntimeError("请先在“我的”页面输入 API Key。")

    config = provider_config()
    url = f"{config['base_url']}/responses"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ProviderError(error.code, provider_error_message(error.code, details), details) from error
    except urllib.error.URLError as error:
        raise ProviderError(None, f"无法连接 AI 服务：{error.reason}") from error


def make_json_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    key = api_key()
    if not key:
        raise RuntimeError("请先在“我的”页面输入 API Key。")

    config = provider_config()
    url = f"{config['base_url']}{path}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ProviderError(error.code, provider_error_message(error.code, details), details) from error
    except urllib.error.URLError as error:
        raise ProviderError(None, f"无法连接 AI 服务：{error.reason}") from error


def make_multipart_post(path: str, fields: dict[str, str], files: list[dict[str, Any]]) -> dict[str, Any]:
    key = api_key()
    if not key:
        raise RuntimeError("请先在“我的”页面输入 API Key。")

    boundary = f"----StyleTapBoundary{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for file in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{file["field"]}"; '
                f'filename="{file["filename"]}"\r\n'
            ).encode("utf-8")
        )
        chunks.append(f'Content-Type: {file["mime"]}\r\n\r\n'.encode("utf-8"))
        chunks.append(file["content"])
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    data = b"".join(chunks)

    config = provider_config()
    url = f"{config['base_url']}{path}"
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ProviderError(error.code, provider_error_message(error.code, details), details) from error
    except urllib.error.URLError as error:
        raise ProviderError(None, f"无法连接 AI 服务：{error.reason}") from error


def provider_error_message(status: int, details: str) -> str:
    message = details
    error_type = ""
    try:
        payload = json.loads(details)
        error = payload.get("error", payload)
        if isinstance(error, dict):
            message = str(error.get("message") or message)
            error_type = str(error.get("type") or error.get("code") or "")
    except Exception:
        pass

    lower = f"{message} {error_type}".lower()
    if status == 401 or "invalid_api_key" in lower or "invalid api key" in lower:
        return "API Key 无效。请到“我的”页面重新输入有效密钥。"
    if status == 429:
        return "AI 服务请求过于频繁或额度不足，请稍后再试。"
    if status == 502 or "upstream" in lower:
        return "AI 网关上游请求失败。通常是当前网关暂时不可用，或该模型不支持图片识别/生图工具。请稍后重试，或更换支持图像能力的模型/接口。"
    if status == 400 and ("image" in lower or "tool" in lower or "unsupported" in lower):
        return "当前模型或接口不支持这次图像请求。请更换支持图片识别/生图的模型或接口。"
    return f"AI 服务返回 HTTP {status}：{message}"


def text_from_response(response: dict[str, Any]) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"].strip()

    parts: list[str] = []
    for item in response.get("output", []) or []:
        for content in item.get("content", []) or []:
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)
            elif isinstance(text, dict) and isinstance(text.get("value"), str):
                parts.append(text["value"])
    return "\n".join(parts).strip()


def looks_like_image_base64(value: str) -> bool:
    if len(value) < 200:
        return False
    cleaned = value.split(",", 1)[1] if value.startswith("data:image/") else value
    if not re.fullmatch(r"[A-Za-z0-9+/=\s_-]+", cleaned):
        return False
    try:
        sample = base64.b64decode(cleaned.replace("-", "+").replace("_", "/"), validate=False)
    except Exception:
        return False
    return sample.startswith((b"\x89PNG", b"\xff\xd8\xff", b"RIFF"))


def find_image_data(value: Any) -> str | None:
    if isinstance(value, str):
        if value.startswith("data:image/") or value.startswith(("http://", "https://")):
            return value
        if looks_like_image_base64(value):
            return value
        return None
    if isinstance(value, dict):
        for key in ("b64_json", "image_base64", "base64", "result", "data", "url", "image_url"):
            found = find_image_data(value.get(key))
            if found:
                return found
        for nested in value.values():
            found = find_image_data(nested)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_image_data(item)
            if found:
                return found
    return None


def normalize_data_url(image_data: str) -> str:
    if image_data.startswith(("http://", "https://")):
        return image_data
    if image_data.startswith("data:image/"):
        return image_data
    return f"data:image/png;base64,{image_data}"


def build_text_payload(request: dict[str, Any]) -> dict[str, Any]:
    config = provider_config()
    prompt = str(request.get("prompt", "")).strip()
    system = str(request.get("system", "")).strip()
    image_data_url = str(request.get("imageDataUrl", "")).strip()
    reasoning_effort = str(request.get("reasoningEffort") or config["reasoning_effort"])

    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    if image_data_url:
        content.append({"type": "input_image", "image_url": image_data_url})

    input_messages: list[dict[str, Any]] = []
    if system:
        input_messages.append({"role": "system", "content": [{"type": "input_text", "text": system}]})
    input_messages.append({"role": "user", "content": content})

    return {
        "model": config["model"],
        "input": input_messages,
        "reasoning": {"effort": reasoning_effort},
        "store": False,
    }


def build_image_payload(request: dict[str, Any]) -> dict[str, Any]:
    config = provider_config()
    prompt = str(request.get("prompt", "")).strip()
    images = image_inputs_from_request(request)
    reasoning_effort = str(request.get("reasoningEffort") or config["reasoning_effort"])
    tool: dict[str, Any] = {
        "type": "image_generation",
        "size": str(request.get("size") or ("1024x1536" if images else "1024x1024")),
    }
    if request.get("quality"):
        tool["quality"] = str(request.get("quality"))

    if images:
        content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
        content.extend({"type": "input_image", "image_url": image} for image in images)
        input_value: str | list[dict[str, Any]] = [{"role": "user", "content": content}]
    else:
        input_value = prompt

    return {
        "model": config["model"],
        "input": input_value,
        "tools": [tool],
        "reasoning": {"effort": reasoning_effort},
        "store": False,
    }


def image_inputs_from_request(request: dict[str, Any]) -> list[str]:
    values: list[Any] = []
    values.append(request.get("imageDataUrl"))
    values.extend(request.get("imageDataUrls") or [])
    values.extend(request.get("referenceImages") or [])

    images: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        candidate = value.strip()
        if not candidate:
            continue
        if candidate.startswith("data:image/") or candidate.startswith(("http://", "https://")):
            images.append(candidate)
    return images[:16]


def image_reference_to_file(image: str, index: int) -> dict[str, Any] | None:
    mime = "image/png"
    content: bytes
    if image.startswith("data:image/"):
        header, encoded = image.split(",", 1)
        mime_match = re.search(r"data:(image/[^;]+)", header)
        if mime_match:
            mime = mime_match.group(1)
        content = base64.b64decode(encoded)
    elif image.startswith(("http://", "https://")):
        with urllib.request.urlopen(image, timeout=60) as response:
            content = response.read()
            mime = response.headers.get_content_type() or mime
    else:
        return None

    extension = mimetypes.guess_extension(mime) or ".png"
    return {
        "field": "image[]",
        "filename": f"reference-{index}{extension}",
        "mime": mime,
        "content": content,
    }


def build_image_api_payload(request: dict[str, Any]) -> dict[str, Any]:
    config = provider_config()
    prompt = str(request.get("prompt", "")).strip()
    payload = {
        "model": str(request.get("imageModel") or config["image_model"]),
        "prompt": prompt,
        "n": 1,
        "size": str(request.get("size") or "1024x1024"),
    }
    if request.get("quality"):
        payload["quality"] = str(request.get("quality"))
    return payload


def make_image_edit_api_request(request: dict[str, Any]) -> dict[str, Any]:
    config = provider_config()
    prompt = str(request.get("prompt", "")).strip()
    files = [
        file
        for index, image in enumerate(image_inputs_from_request(request), start=1)
        if (file := image_reference_to_file(image, index))
    ]
    if not files:
        raise ProviderError(None, "没有可发送给 Image Edit API 的参考图片。")

    fields = {
        "model": str(request.get("imageModel") or config["image_model"]),
        "prompt": prompt,
        "size": str(request.get("size") or "1024x1536"),
        "quality": str(request.get("quality") or "auto"),
    }
    return make_multipart_post("/images/edits", fields, files)


def generate_image_with_fallback(request: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    images = image_inputs_from_request(request)

    try:
        response = make_response_request(build_image_payload(request))
        image_data = find_image_data(response)
        if image_data:
            return image_data, errors
        errors.append(
            {
                "mode": "responses",
                "message": "Responses API 没有返回图片数据。",
                "raw": response,
            }
        )
    except ProviderError as error:
        errors.append(
            {
                "mode": "responses",
                "message": str(error),
                "status": error.status,
                "details": error.details,
            }
        )

    if images:
        try:
            response = make_image_edit_api_request(request)
            image_data = find_image_data(response)
            if image_data:
                return image_data, errors
            errors.append(
                {
                    "mode": "images_edits",
                    "message": "Image Edit API 没有返回图片数据。",
                    "raw": response,
                }
            )
        except ProviderError as error:
            errors.append(
                {
                    "mode": "images_edits",
                    "message": str(error),
                    "status": error.status,
                    "details": error.details,
                }
            )

    try:
        response = make_json_post("/images/generations", build_image_api_payload(request))
        image_data = find_image_data(response)
        if image_data:
            return image_data, errors
        errors.append(
            {
                "mode": "images",
                "message": "Image API 没有返回图片数据。",
                "raw": response,
            }
        )
    except ProviderError as error:
        errors.append(
            {
                "mode": "images",
                "message": str(error),
                "status": error.status,
                "details": error.details,
            }
        )

    return None, errors


class StyleTapHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"/", "/index.html", "/service-worker.js", "/manifest.webmanifest"}:
            self.send_header("Cache-Control", "no-store")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/database":
            if not server_database_enabled():
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "exists": False,
                        "database": None,
                        "path": "browser localStorage",
                        "disabled": True,
                    },
                )
                return

            database = read_database_file()
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "exists": database is not None,
                    "database": database,
                    "path": "data/wardrobe.json",
                },
            )
            return

        if self.path == "/api/config":
            config = provider_config()
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "provider": "OpenAI",
                    "baseUrl": config["base_url"],
                    "model": config["model"],
                    "imageModel": config["image_model"],
                    "reasoningEffort": config["reasoning_effort"],
                    "hasApiKey": bool(api_key()),
                    "keySource": api_key_source(),
                    "runtimeApiKeyEnabled": runtime_api_key_enabled(),
                    "serverDatabaseEnabled": server_database_enabled(),
                    "responseStorageDisabled": True,
                },
            )
            return

        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        super().do_GET()

    def do_POST(self) -> None:
        global RUNTIME_API_KEY
        try:
            request = read_json(self)
            if self.path == "/api/key":
                if not runtime_api_key_enabled():
                    json_response(
                        self,
                        200,
                        {
                            "ok": False,
                            "error": "线上部署不接受网页临时 API Key。请在服务器环境变量 OPENAI_API_KEY 中配置，或保持 AI 未连接状态。",
                            "hasApiKey": bool(api_key()),
                            "keySource": api_key_source(),
                        },
                    )
                    return
                candidate = str(request.get("apiKey", "")).strip()
                if not candidate:
                    json_response(self, 400, {"ok": False, "error": "Missing API key."})
                    return
                RUNTIME_API_KEY = candidate
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "hasApiKey": True,
                        "keySource": "runtime",
                    },
                )
                return

            if self.path == "/api/database":
                if not server_database_enabled():
                    json_response(
                        self,
                        200,
                        {
                            "ok": True,
                            "saved": False,
                            "path": "browser localStorage",
                            "disabled": True,
                        },
                    )
                    return
                size = save_database_file(database_from_request(request))
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "saved": True,
                        "path": "data/wardrobe.json",
                        "bytes": size,
                    },
                )
                return

            if self.path == "/api/text":
                if not str(request.get("prompt", "")).strip():
                    json_response(self, 400, {"ok": False, "error": "Missing prompt."})
                    return
                response = make_response_request(build_text_payload(request))
                json_response(self, 200, {"ok": True, "text": text_from_response(response), "raw": response})
                return

            if self.path == "/api/image":
                if not str(request.get("prompt", "")).strip():
                    json_response(self, 400, {"ok": False, "error": "Missing prompt."})
                    return
                image_data, image_errors = generate_image_with_fallback(request)
                if not image_data:
                    json_response(
                        self,
                        200,
                        {
                            "ok": False,
                            "error": image_errors[-1]["message"] if image_errors else "AI 服务没有返回图片数据。",
                            "attempts": image_errors,
                        },
                    )
                    return
                json_response(self, 200, {"ok": True, "imageDataUrl": normalize_data_url(image_data)})
                return

            json_response(self, 404, {"ok": False, "error": "Unknown API path."})
        except json.JSONDecodeError:
            json_response(self, 400, {"ok": False, "error": "Invalid JSON."})
        except ProviderError as error:
            json_response(
                self,
                200,
                {
                    "ok": False,
                    "error": str(error),
                    "providerStatus": error.status,
                    "providerDetails": error.details,
                },
            )
        except RuntimeError as error:
            json_response(self, 200, {"ok": False, "error": str(error)})
        except Exception as error:
            json_response(self, 500, {"ok": False, "error": str(error)})

    def do_DELETE(self) -> None:
        global RUNTIME_API_KEY
        if self.path == "/api/database":
            if not server_database_enabled():
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "deleted": False,
                        "path": "browser localStorage",
                        "disabled": True,
                    },
                )
                return
            deleted = delete_database_file()
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "deleted": deleted,
                    "path": "data/wardrobe.json",
                },
            )
            return

        if self.path == "/api/key":
            if not runtime_api_key_enabled():
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "hasApiKey": bool(api_key()),
                        "keySource": api_key_source(),
                        "runtimeApiKeyEnabled": False,
                    },
                )
                return
            RUNTIME_API_KEY = ""
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "hasApiKey": bool(api_key()),
                    "keySource": api_key_source(),
                },
            )
            return

        json_response(self, 404, {"ok": False, "error": "Unknown API path."})

    def guess_type(self, path: str) -> str:
        if path.endswith(".js"):
            return "text/javascript"
        if path.endswith(".webmanifest"):
            return "application/manifest+json"
        return mimetypes.guess_type(path)[0] or super().guess_type(path)


def run() -> None:
    port = int(env("PORT", "5173"))
    host = env("HOST", "127.0.0.1")
    server = ThreadingHTTPServer((host, port), StyleTapHandler)
    print(f"StyleTap server running at http://{host}:{port}")
    if host == "0.0.0.0":
        print(f"LAN access enabled. Other devices should use this computer's LAN IP, for example http://192.168.x.x:{port}")
    print("OPENAI_API_KEY configured:", "yes" if api_key() else "no")
    server.serve_forever()


if __name__ == "__main__":
    run()
