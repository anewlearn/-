from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import queue
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATABASE_PATH = DATA_DIR / "wardrobe.json"
UPLOAD_DIR = DATA_DIR / "uploads"
GENERATED_DIR = DATA_DIR / "generated"
PROCESSING_TASKS_PATH = DATA_DIR / "processing_tasks.json"
DEFAULT_BASE_URL = "https://ai-us.hctopup.com/v1"
DEFAULT_MODEL = "gpt-5.5"
DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_REASONING_EFFORT = "xhigh"
DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash"
DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image"
DEFAULT_WECHAT_API_BASE = "https://api.weixin.qq.com"
DEFAULT_WECHAT_PAY_API_BASE = "https://api.mch.weixin.qq.com"
DEFAULT_WECHAT_PAYMENT_DESCRIPTION = "搭一下会员服务"
RUNTIME_PROVIDER = ""
RUNTIME_API_KEYS: list[str] = []
API_KEY_ROTATION_INDEX: dict[str, int] = {"openai": 0, "google": 0}
API_KEY_ROTATION_LOCK = threading.Lock()
PROCESSING_TASKS: dict[str, dict[str, Any]] = {}
PROCESSING_TASKS_LOADED = False
PROCESSING_WORKERS_STARTED = False
PROCESSING_TASK_LOCK = threading.RLock()
PROCESSING_QUEUE: queue.Queue[str] = queue.Queue()
PROCESSING_QUEUED_IDS: set[str] = set()
PROCESSING_TERMINAL_STATUSES = {"completed", "failed", "cached"}
CLEANUP_THREAD_STARTED = False
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


def normalize_provider(provider: str = "") -> str:
    value = (provider or "").strip().lower()
    if value in {"google", "gemini", "google_gemini"}:
        return "google"
    return "openai"


def provider_label(provider: str = "") -> str:
    return "Google Gemini" if normalize_provider(provider) == "google" else "OpenAI"


def active_provider_id() -> str:
    configured = RUNTIME_PROVIDER or env("AI_PROVIDER") or env("MODEL_PROVIDER") or "openai"
    return normalize_provider(configured)


def provider_config(provider: str = "") -> dict[str, str]:
    provider_id = normalize_provider(provider or active_provider_id())
    if provider_id == "google":
        return {
            "provider": "google",
            "label": "Google Gemini",
            "base_url": env("GOOGLE_BASE_URL", DEFAULT_GOOGLE_BASE_URL).rstrip("/"),
            "model": env("GOOGLE_MODEL", DEFAULT_GOOGLE_MODEL),
            "image_model": env("GOOGLE_IMAGE_MODEL", DEFAULT_GOOGLE_IMAGE_MODEL),
            "reasoning_effort": env("GOOGLE_REASONING_EFFORT", env("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT)),
        }
    return {
        "provider": "openai",
        "label": "OpenAI",
        "base_url": env("OPENAI_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "model": env("OPENAI_MODEL", DEFAULT_MODEL),
        "image_model": env("OPENAI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL),
        "reasoning_effort": env("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT),
    }


def split_env_values(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[\s,;]+", value or "") if item.strip()]


def add_unique_keys(keys: list[str], values: list[str]) -> None:
    for value in values:
        if value and value not in keys:
            keys.append(value)


def configured_api_keys(provider: str = "") -> list[str]:
    provider_id = normalize_provider(provider or active_provider_id())
    if RUNTIME_API_KEYS and normalize_provider(RUNTIME_PROVIDER) == provider_id:
        return RUNTIME_API_KEYS

    keys: list[str] = []
    if provider_id == "google":
        add_unique_keys(keys, split_env_values(env("GOOGLE_API_KEYS")))
        add_unique_keys(keys, split_env_values(env("GEMINI_API_KEYS")))
        add_unique_keys(keys, split_env_values(env("GOOGLE_API_KEY")))
        add_unique_keys(keys, split_env_values(env("GEMINI_API_KEY")))
    else:
        add_unique_keys(keys, split_env_values(env("OPENAI_API_KEYS")))
        add_unique_keys(keys, split_env_values(env("OPENAI_API_KEY")))

    return keys


def api_key(provider: str = "") -> str:
    keys = configured_api_keys(provider)
    return keys[0] if keys else ""


def next_api_key(provider: str = "") -> str:
    candidates = api_key_candidates(provider)
    return candidates[0] if candidates else ""


def api_key_candidates(provider: str = "") -> list[str]:
    provider_id = normalize_provider(provider or active_provider_id())
    keys = configured_api_keys(provider_id)
    if len(keys) <= 1:
        return keys
    with API_KEY_ROTATION_LOCK:
        start = API_KEY_ROTATION_INDEX.get(provider_id, 0) % len(keys)
        API_KEY_ROTATION_INDEX[provider_id] = start + 1
    return keys[start:] + keys[:start]


def api_key_count(provider: str = "") -> int:
    return len(configured_api_keys(provider))


def api_key_source(provider: str = "") -> str:
    provider_id = normalize_provider(provider or active_provider_id())
    if RUNTIME_API_KEYS and normalize_provider(RUNTIME_PROVIDER) == provider_id:
        return "runtime"
    if api_key_count(provider_id) > 1:
        return "environment_pool"
    if api_key_count(provider_id) == 1:
        return "environment"
    return "none"


def retryable_provider_error(error: ProviderError) -> bool:
    if error.status is None:
        return True
    lower = f"{error} {error.details}".lower()
    if error.status == 403 and any(token in lower for token in ("quota", "rate", "limit", "exhausted", "resource_exhausted")):
        return True
    return error.status in {408, 409, 425, 429, 500, 502, 503, 504}


def request_with_key_failover(
    request_factory: Any,
    timeout: int,
    missing_key_message: str = "请先在“我的”页面输入 API Key。",
    provider: str = "",
) -> dict[str, Any]:
    provider_id = normalize_provider(provider or active_provider_id())
    candidates = api_key_candidates(provider_id)
    if not candidates:
        raise RuntimeError(missing_key_message)

    attempts: list[dict[str, Any]] = []
    last_error: ProviderError | None = None
    for index, key in enumerate(candidates):
        try:
            request = request_factory(key)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            provider_error = ProviderError(error.code, provider_error_message(error.code, details), details)
        except urllib.error.URLError as error:
            provider_error = ProviderError(None, f"无法连接 AI 服务：{error.reason}")

        last_error = provider_error
        attempts.append(
            {
                "provider": provider_label(provider_id),
                "keyIndex": index + 1,
                "status": provider_error.status,
                "message": str(provider_error),
            }
        )
        if index < len(candidates) - 1 and retryable_provider_error(provider_error):
            continue
        break

    if last_error is None:
        raise RuntimeError(missing_key_message)

    if len(attempts) > 1:
        failover_details = json.dumps({"failoverAttempts": attempts}, ensure_ascii=False)
        details = f"{last_error.details}\n{failover_details}" if last_error.details else failover_details
        raise ProviderError(last_error.status, str(last_error), details) from last_error
    raise last_error


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


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_iso_timestamp(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return time.mktime(time.strptime(text.replace("Z", ""), "%Y-%m-%dT%H:%M:%S"))
    except Exception:
        return 0


def public_base_url(handler: SimpleHTTPRequestHandler | None = None) -> str:
    configured = env("PUBLIC_APP_URL") or env("RENDER_EXTERNAL_URL")
    if configured:
        return configured.rstrip("/")
    if handler is None:
        return ""
    host = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or ""
    if not host:
        return ""
    proto = handler.headers.get("X-Forwarded-Proto") or ("https" if "onrender.com" in host else "http")
    return f"{proto}://{host}".rstrip("/")


def relative_url_for_path(path: Path) -> str:
    relative = path.resolve().relative_to(ROOT).as_posix()
    return "/" + urllib.parse.quote(relative, safe="/")


def absolute_url_for_path(path: Path, base_url: str = "") -> str:
    relative = relative_url_for_path(path)
    return f"{base_url.rstrip('/')}{relative}" if base_url else relative


def is_path_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def file_path_from_asset_reference(value: Any) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    parsed_path = urllib.parse.urlparse(text).path if text.startswith(("http://", "https://")) else text
    parsed_path = urllib.parse.unquote(parsed_path)
    if parsed_path.startswith("/"):
        parsed_path = parsed_path.lstrip("/")
    candidate = Path(parsed_path)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    if not is_path_inside(candidate, DATA_DIR):
        return None
    return candidate


def delete_file_if_present(path: Path | None) -> bool:
    if not path or not is_path_inside(path, DATA_DIR):
        return False
    try:
        if path.exists() and path.is_file():
            path.unlink()
            return True
    except Exception as error:
        print("Failed to delete temporary asset:", path, error)
    return False


def prune_empty_dirs(path: Path | None) -> None:
    if not path:
        return
    current = path.parent if path.is_file() else path
    for _ in range(4):
        if not is_path_inside(current, DATA_DIR) or current == DATA_DIR:
            break
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def safe_filename(value: str, fallback: str = "image") -> str:
    name = Path(value or fallback).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return name[:96] or fallback


def parse_content_disposition(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in value.split(";"):
        part = item.strip()
        if not part:
            continue
        if "=" not in part:
            result["type"] = part.lower()
            continue
        key, raw = part.split("=", 1)
        result[key.strip().lower()] = raw.strip().strip('"')
    return result


def parse_multipart_form(handler: SimpleHTTPRequestHandler) -> tuple[dict[str, str], list[dict[str, Any]]]:
    content_type = handler.headers.get("Content-Type", "")
    match = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", content_type)
    if not match:
        raise RuntimeError("上传失败：缺少 multipart boundary。")
    boundary = (match.group(1) or match.group(2) or "").encode("utf-8")
    length = int(handler.headers.get("Content-Length", "0"))
    max_bytes = int(env("MAX_IMAGE_UPLOAD_BYTES", "30000000"))
    if length <= 0:
        raise RuntimeError("上传失败：没有收到图片文件。")
    if length > max_bytes:
        raise RuntimeError(f"图片过大：单张最大 {max_bytes // 1024 // 1024}MB。")

    raw = handler.rfile.read(length)
    marker = b"--" + boundary
    fields: dict[str, str] = {}
    files: list[dict[str, Any]] = []

    for part in raw.split(marker):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].rstrip(b"\r\n")
        if b"\r\n\r\n" not in part:
            continue
        header_blob, content = part.split(b"\r\n\r\n", 1)
        if content.endswith(b"\r\n"):
            content = content[:-2]
        headers: dict[str, str] = {}
        for line in header_blob.decode("utf-8", errors="replace").split("\r\n"):
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
        disposition = parse_content_disposition(headers.get("content-disposition", ""))
        name = disposition.get("name", "")
        if not name:
            continue
        filename = disposition.get("filename", "")
        if filename:
            files.append(
                {
                    "field": name,
                    "filename": safe_filename(filename),
                    "mime": headers.get("content-type") or mimetypes.guess_type(filename)[0] or "application/octet-stream",
                    "content": content,
                }
            )
        else:
            fields[name] = content.decode("utf-8", errors="replace")
    return fields, files


def save_uploaded_image(file: dict[str, Any], base_url: str) -> dict[str, Any]:
    content = file.get("content") or b""
    if not isinstance(content, bytes) or not content:
        raise RuntimeError("上传失败：图片内容为空。")
    mime = str(file.get("mime") or "application/octet-stream")
    if not mime.startswith("image/"):
        raise RuntimeError("上传失败：只能上传图片文件。")
    digest = hashlib.sha256(content).hexdigest()
    extension = mimetypes.guess_extension(mime) or Path(file.get("filename", "")).suffix or ".jpg"
    if extension == ".jpe":
        extension = ".jpg"
    day = time.strftime("%Y%m%d", time.localtime())
    upload_dir = UPLOAD_DIR / day
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{int(time.time())}-{secrets.token_hex(5)}-{digest[:10]}{extension}"
    target.write_bytes(content)
    return {
        "id": f"upload-{digest[:16]}",
        "fileName": str(file.get("filename") or target.name),
        "mime": mime,
        "sha256": digest,
        "bytes": len(content),
        "path": str(target),
        "url": absolute_url_for_path(target, base_url),
        "relativeUrl": relative_url_for_path(target),
        "createdAt": iso_now(),
    }


def save_processing_tasks() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"tasks": list(PROCESSING_TASKS.values()), "updatedAt": iso_now()}
    temp_path = PROCESSING_TASKS_PATH.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(PROCESSING_TASKS_PATH)


def load_processing_tasks() -> None:
    global PROCESSING_TASKS_LOADED
    with PROCESSING_TASK_LOCK:
        if PROCESSING_TASKS_LOADED:
            return
        PROCESSING_TASKS_LOADED = True
        if not PROCESSING_TASKS_PATH.exists():
            return
        try:
            payload = json.loads(PROCESSING_TASKS_PATH.read_text(encoding="utf-8"))
            tasks = payload.get("tasks", []) if isinstance(payload, dict) else []
            for task in tasks:
                if not isinstance(task, dict) or not task.get("id"):
                    continue
                if task.get("status") not in PROCESSING_TERMINAL_STATUSES:
                    task = {
                        **task,
                        "status": "queued",
                        "statusText": "服务恢复，等待继续处理",
                        "progress": min(int(task.get("progress") or 5), 20),
                        "updatedAt": iso_now(),
                    }
                PROCESSING_TASKS[str(task["id"])] = task
        except Exception as error:
            print("Failed to load processing tasks:", error)


def get_processing_task(task_id: str) -> dict[str, Any] | None:
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        task = PROCESSING_TASKS.get(task_id)
        return json.loads(json.dumps(task, ensure_ascii=False)) if task else None


def list_processing_tasks(ids: list[str] | None = None) -> list[dict[str, Any]]:
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        values = list(PROCESSING_TASKS.values())
        if ids:
            wanted = set(ids)
            values = [task for task in values if task.get("id") in wanted]
        values.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
        return json.loads(json.dumps(values[:80], ensure_ascii=False))


def update_processing_task(task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        task = PROCESSING_TASKS.get(task_id)
        if not task:
            return None
        task.update(patch)
        task["updatedAt"] = iso_now()
        save_processing_tasks()
        return json.loads(json.dumps(task, ensure_ascii=False))


def find_cached_processing_task(cache_key: str) -> dict[str, Any] | None:
    if not cache_key:
        return None
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        for task in PROCESSING_TASKS.values():
            if (
                task.get("cacheKey") == cache_key
                and task.get("status") in {"completed", "cached"}
                and task.get("garments")
                and not task.get("assetsCleanedAt")
            ):
                return json.loads(json.dumps(task, ensure_ascii=False))
    return None


def task_generated_asset_paths(task: dict[str, Any]) -> list[Path]:
    paths: list[Path] = []
    for garment in task.get("garments", []) or []:
        if not isinstance(garment, dict):
            continue
        image_path = file_path_from_asset_reference(garment.get("imagePath"))
        if image_path and is_path_inside(image_path, GENERATED_DIR):
            paths.append(image_path)
    return paths


def cleanup_task_assets(task: dict[str, Any], remove_upload: bool = True, remove_generated: bool = True) -> dict[str, Any]:
    deleted: list[str] = []
    if remove_upload:
        upload = task.get("upload") if isinstance(task.get("upload"), dict) else {}
        upload_path = file_path_from_asset_reference(upload.get("path") or upload.get("url") or task.get("imageUrl"))
        if upload_path and delete_file_if_present(upload_path):
            prune_empty_dirs(upload_path)
            deleted.append(relative_url_for_path(upload_path))
        task["uploadCleanedAt"] = task.get("uploadCleanedAt") or iso_now()

    if remove_generated:
        for path in task_generated_asset_paths(task):
            if delete_file_if_present(path):
                prune_empty_dirs(path)
                deleted.append(relative_url_for_path(path))
        task["generatedCleanedAt"] = task.get("generatedCleanedAt") or iso_now()

    if remove_upload and remove_generated:
        task["assetsCleanedAt"] = task.get("assetsCleanedAt") or iso_now()
    if deleted:
        task["deletedAssets"] = sorted(set([*task.get("deletedAssets", []), *deleted]))
    return task


def ack_processing_tasks(task_ids: list[str]) -> dict[str, Any]:
    load_processing_tasks()
    cleaned: list[str] = []
    missing: list[str] = []
    with PROCESSING_TASK_LOCK:
        for task_id in task_ids:
            task = PROCESSING_TASKS.get(task_id)
            if not task:
                missing.append(task_id)
                continue
            cleanup_task_assets(task, remove_upload=True, remove_generated=True)
            task["clientSavedAt"] = iso_now()
            task["updatedAt"] = iso_now()
            cleaned.append(task_id)
        if cleaned:
            save_processing_tasks()
    return {"cleaned": cleaned, "missing": missing}


def cleanup_processing_storage(force: bool = False) -> dict[str, Any]:
    load_processing_tasks()
    now = time.time()
    upload_ttl = 0 if force else max(60, int(env("UPLOAD_RETENTION_SECONDS", "3600")))
    generated_ttl = 0 if force else max(300, int(env("GENERATED_RETENTION_SECONDS", "86400")))
    record_ttl = max(3600, int(env("TASK_RECORD_RETENTION_SECONDS", str(7 * 86400))))
    changed = False
    removed_records = 0
    cleaned_uploads = 0
    cleaned_generated = 0

    with PROCESSING_TASK_LOCK:
        for task_id, task in list(PROCESSING_TASKS.items()):
            status = task.get("status")
            if status not in PROCESSING_TERMINAL_STATUSES:
                continue
            completed_at = parse_iso_timestamp(task.get("updatedAt") or task.get("createdAt"))
            age = now - completed_at if completed_at else 0
            if not task.get("uploadCleanedAt") and (force or age >= upload_ttl):
                before = len(task.get("deletedAssets", []))
                cleanup_task_assets(task, remove_upload=True, remove_generated=False)
                cleaned_uploads += max(0, len(task.get("deletedAssets", [])) - before)
                changed = True
            if not task.get("generatedCleanedAt") and (force or age >= generated_ttl):
                before = len(task.get("deletedAssets", []))
                cleanup_task_assets(task, remove_upload=False, remove_generated=True)
                cleaned_generated += max(0, len(task.get("deletedAssets", [])) - before)
                changed = True
            if age >= record_ttl and task.get("uploadCleanedAt") and task.get("generatedCleanedAt"):
                PROCESSING_TASKS.pop(task_id, None)
                removed_records += 1
                changed = True
        if changed:
            save_processing_tasks()

    return {
        "cleanedUploads": cleaned_uploads,
        "cleanedGenerated": cleaned_generated,
        "removedRecords": removed_records,
    }


def enqueue_processing_task(task_id: str) -> None:
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        task = PROCESSING_TASKS.get(task_id)
        if not task or task.get("status") in PROCESSING_TERMINAL_STATUSES or task_id in PROCESSING_QUEUED_IDS:
            return
        PROCESSING_QUEUED_IDS.add(task_id)
    ensure_processing_workers()
    PROCESSING_QUEUE.put(task_id)


def create_processing_task(upload: dict[str, Any], fields: dict[str, str], base_url: str) -> dict[str, Any]:
    load_processing_tasks()
    mode = "outfit" if fields.get("mode") == "outfit" else "single"
    ai_mode = "normal" if fields.get("aiMode") == "normal" else "fast"
    generate_flat = str(fields.get("generateFlat", "true")).lower() not in {"0", "false", "no", "off"}
    cache_key = hashlib.sha256(
        f"{upload['sha256']}:{mode}:{ai_mode}:{generate_flat}:async-v1".encode("utf-8")
    ).hexdigest()
    task_id = f"task-{uuid.uuid4().hex}"
    now = iso_now()
    task = {
        "id": task_id,
        "status": "queued",
        "statusText": "已保存原图，等待后端处理",
        "progress": 8,
        "mode": mode,
        "aiMode": ai_mode,
        "generateFlat": generate_flat,
        "cacheKey": cache_key,
        "upload": upload,
        "fileName": upload.get("fileName"),
        "imageUrl": upload.get("url"),
        "originalImagePath": upload.get("url"),
        "publicBaseUrl": base_url,
        "garments": [],
        "error": "",
        "createdAt": now,
        "updatedAt": now,
    }
    cached = find_cached_processing_task(cache_key)
    if cached:
        task.update(
            {
                "status": "cached",
                "statusText": "已复用缓存结果",
                "progress": 100,
                "garments": cached.get("garments", []),
                "cachedFrom": cached.get("id"),
            }
        )
    with PROCESSING_TASK_LOCK:
        PROCESSING_TASKS[task_id] = task
        save_processing_tasks()
    if task["status"] != "cached":
        enqueue_processing_task(task_id)
    return json.loads(json.dumps(task, ensure_ascii=False))


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


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def wechat_app_id() -> str:
    return env("WECHAT_APP_ID")


def wechat_app_secret() -> str:
    return env("WECHAT_APP_SECRET")


def wechat_session_secret() -> str:
    return env("WECHAT_SESSION_SECRET") or wechat_app_secret()


def wechat_web_url() -> str:
    return env("WECHAT_MINIPROGRAM_WEB_URL") or env("PUBLIC_APP_URL")


def wechat_private_key_configured() -> bool:
    return bool(env("WECHAT_PAY_PRIVATE_KEY") or env("WECHAT_PAY_PRIVATE_KEY_PATH"))


def wechat_login_enabled() -> bool:
    return bool(wechat_app_id() and wechat_app_secret())


def wechat_payment_enabled() -> bool:
    return bool(
        wechat_app_id()
        and env("WECHAT_PAY_MCH_ID")
        and env("WECHAT_PAY_SERIAL_NO")
        and env("WECHAT_PAY_NOTIFY_URL")
        and wechat_private_key_configured()
    )


def wechat_public_config() -> dict[str, Any]:
    return {
        "loginEnabled": wechat_login_enabled(),
        "paymentEnabled": wechat_payment_enabled(),
        "webUrl": wechat_web_url(),
        "appIdConfigured": bool(wechat_app_id()),
        "appSecretConfigured": bool(wechat_app_secret()),
        "merchantConfigured": bool(env("WECHAT_PAY_MCH_ID")),
        "notifyUrlConfigured": bool(env("WECHAT_PAY_NOTIFY_URL")),
        "privateKeyConfigured": wechat_private_key_configured(),
    }


def wechat_code2session(code: str) -> dict[str, Any]:
    app_id = wechat_app_id()
    app_secret = wechat_app_secret()
    if not app_id or not app_secret:
        raise RuntimeError("微信登录未配置：请设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET。")
    params = urllib.parse.urlencode(
        {
            "appid": app_id,
            "secret": app_secret,
            "js_code": code,
            "grant_type": "authorization_code",
        }
    )
    base_url = env("WECHAT_API_BASE", DEFAULT_WECHAT_API_BASE).rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/sns/jscode2session?{params}",
        headers={"Accept": "application/json", "User-Agent": "StyleTap/0.1"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    errcode = payload.get("errcode")
    if errcode:
        errmsg = payload.get("errmsg", "unknown error")
        raise RuntimeError(f"微信登录失败：{errmsg} ({errcode})")
    if not payload.get("openid"):
        raise RuntimeError("微信登录失败：接口没有返回 openid。")
    return payload


def make_wechat_session_token(session: dict[str, Any]) -> str:
    secret = wechat_session_secret()
    if not secret:
        raise RuntimeError("微信会话签名未配置：请设置 WECHAT_SESSION_SECRET。")
    payload = {
        "openid": session["openid"],
        "unionid": session.get("unionid"),
        "iat": int(time.time()),
    }
    payload_b64 = base64url_encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{base64url_encode(signature)}"


def verify_wechat_session_token(token: str) -> dict[str, Any]:
    secret = wechat_session_secret()
    if not secret:
        raise RuntimeError("微信会话签名未配置：请设置 WECHAT_SESSION_SECRET。")
    try:
        payload_b64, signature_b64 = str(token or "").split(".", 1)
        expected = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
        actual = base64url_decode(signature_b64)
    except Exception as error:
        raise RuntimeError("微信登录状态无效，请重新登录。") from error
    if not hmac.compare_digest(expected, actual):
        raise RuntimeError("微信登录状态已失效，请重新登录。")
    payload = json.loads(base64url_decode(payload_b64).decode("utf-8"))
    ttl_days = int(env("WECHAT_SESSION_TTL_DAYS", "30"))
    if int(time.time()) - int(payload.get("iat", 0)) > ttl_days * 86400:
        raise RuntimeError("微信登录状态已过期，请重新登录。")
    if not payload.get("openid"):
        raise RuntimeError("微信登录状态无效，请重新登录。")
    return payload


def wechat_user_id(openid: str) -> str:
    digest = hashlib.sha256(openid.encode("utf-8")).hexdigest()
    return f"wx_{digest[:20]}"


def load_wechat_pay_private_key() -> Any:
    raw = env("WECHAT_PAY_PRIVATE_KEY")
    path = env("WECHAT_PAY_PRIVATE_KEY_PATH")
    if path:
        raw = Path(path).read_text(encoding="utf-8")
    if not raw:
        raise RuntimeError("微信支付未配置商户私钥：请设置 WECHAT_PAY_PRIVATE_KEY 或 WECHAT_PAY_PRIVATE_KEY_PATH。")
    raw = raw.replace("\\n", "\n").strip()
    try:
        from cryptography.hazmat.primitives import serialization
    except ModuleNotFoundError as error:
        raise RuntimeError("微信支付需要 cryptography 依赖，请先运行 pip install -r requirements.txt。") from error
    return serialization.load_pem_private_key(raw.encode("utf-8"), password=None)


def sign_wechat_pay_message(message: str) -> str:
    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
    except ModuleNotFoundError as error:
        raise RuntimeError("微信支付需要 cryptography 依赖，请先运行 pip install -r requirements.txt。") from error
    private_key = load_wechat_pay_private_key()
    signature = private_key.sign(message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("ascii")


def make_wechat_pay_request(method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    mch_id = env("WECHAT_PAY_MCH_ID")
    serial_no = env("WECHAT_PAY_SERIAL_NO")
    if not mch_id or not serial_no:
        raise RuntimeError("微信支付未配置：请设置 WECHAT_PAY_MCH_ID 和 WECHAT_PAY_SERIAL_NO。")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    message = f"{method}\n{path}\n{timestamp}\n{nonce}\n{body}\n"
    signature = sign_wechat_pay_message(message)
    auth = (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{mch_id}",nonce_str="{nonce}",signature="{signature}",'
        f'timestamp="{timestamp}",serial_no="{serial_no}"'
    )
    base_url = env("WECHAT_PAY_API_BASE", DEFAULT_WECHAT_PAY_API_BASE).rstrip("/")
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body.encode("utf-8"),
        method=method,
        headers={
            "Authorization": auth,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "StyleTap/0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"微信支付下单失败：HTTP {error.code} {details}") from error


def create_wechat_payment_params(request: dict[str, Any]) -> dict[str, Any]:
    if not wechat_payment_enabled():
        raise RuntimeError("微信支付未完整配置，请检查商户号、证书序列号、私钥和通知地址。")
    session = verify_wechat_session_token(str(request.get("sessionToken") or request.get("token") or ""))
    amount = int(request.get("amountCents") or env("WECHAT_PAY_DEFAULT_AMOUNT_CENTS", "990"))
    max_amount = int(env("WECHAT_PAY_MAX_AMOUNT_CENTS", "200000"))
    if amount < 1 or amount > max_amount:
        raise RuntimeError("支付金额不在允许范围内。")
    description = str(request.get("description") or env("WECHAT_PAY_DESCRIPTION", DEFAULT_WECHAT_PAYMENT_DESCRIPTION))[:127]
    out_trade_no = f"DT{int(time.time())}{secrets.token_hex(5)}".upper()
    body = {
        "appid": wechat_app_id(),
        "mchid": env("WECHAT_PAY_MCH_ID"),
        "description": description,
        "out_trade_no": out_trade_no,
        "notify_url": env("WECHAT_PAY_NOTIFY_URL"),
        "amount": {"total": amount, "currency": "CNY"},
        "payer": {"openid": session["openid"]},
    }
    prepay = make_wechat_pay_request("POST", "/v3/pay/transactions/jsapi", body)
    prepay_id = prepay.get("prepay_id")
    if not prepay_id:
        raise RuntimeError("微信支付下单失败：接口没有返回 prepay_id。")
    package = f"prepay_id={prepay_id}"
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    pay_sign = sign_wechat_pay_message(f"{wechat_app_id()}\n{timestamp}\n{nonce}\n{package}\n")
    return {
        "outTradeNo": out_trade_no,
        "amountCents": amount,
        "paymentParams": {
            "timeStamp": timestamp,
            "nonceStr": nonce,
            "package": package,
            "signType": "RSA",
            "paySign": pay_sign,
        },
    }


def make_response_request(payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    config = provider_config("openai")
    url = f"{config['base_url']}/responses"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def factory(key: str) -> urllib.request.Request:
        return urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    return request_with_key_failover(factory, timeout=timeout, provider="openai")


def make_json_post(path: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    config = provider_config("openai")
    url = f"{config['base_url']}{path}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def factory(key: str) -> urllib.request.Request:
        return urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    return request_with_key_failover(factory, timeout=timeout, provider="openai")


def make_multipart_post(path: str, fields: dict[str, str], files: list[dict[str, Any]], timeout: int = 180) -> dict[str, Any]:
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

    config = provider_config("openai")
    url = f"{config['base_url']}{path}"

    def factory(key: str) -> urllib.request.Request:
        return urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Accept": "application/json",
            },
        )

    return request_with_key_failover(factory, timeout=timeout, provider="openai")


def google_model_path(model: str) -> str:
    value = str(model or "").strip()
    if value.startswith("models/"):
        return value
    return f"models/{value}"


def make_google_generate_content(payload: dict[str, Any], model: str = "", timeout: int = 120) -> dict[str, Any]:
    config = provider_config("google")
    model_path = google_model_path(model or config["model"])
    url = f"{config['base_url']}/{model_path}:generateContent"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def factory(key: str) -> urllib.request.Request:
        return urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "x-goog-api-key": key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    return request_with_key_failover(factory, timeout=timeout, provider="google")


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
    if status == 429 or ("quota" in lower or "resource_exhausted" in lower or "rate limit" in lower):
        return "AI 服务请求过于频繁或额度不足，已尝试切换可用 Key；如果全部失败，请稍后再试或补充新的 Key。"
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


def text_from_google_response(response: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in response.get("candidates", []) or []:
        content = candidate.get("content", {}) if isinstance(candidate, dict) else {}
        for part in content.get("parts", []) or []:
            text = part.get("text") if isinstance(part, dict) else None
            if isinstance(text, str):
                parts.append(text)
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
        inline = value.get("inlineData") or value.get("inline_data")
        if isinstance(inline, dict):
            data = inline.get("data")
            mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            if isinstance(data, str) and looks_like_image_base64(data):
                return f"data:{mime};base64,{data}"
        for key in ("b64_json", "image_base64", "base64", "inlineData", "inline_data", "result", "data", "url", "image_url"):
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


def image_reference_to_google_part(image: str, index: int) -> dict[str, Any] | None:
    mime = "image/png"
    encoded = ""
    if image.startswith("data:image/"):
        header, encoded = image.split(",", 1)
        mime_match = re.search(r"data:(image/[^;]+)", header)
        if mime_match:
            mime = mime_match.group(1)
    elif image.startswith(("http://", "https://")):
        with urllib.request.urlopen(image, timeout=60) as response:
            content = response.read()
            mime = response.headers.get_content_type() or mime
            encoded = base64.b64encode(content).decode("ascii")
    else:
        return None

    return {
        "inlineData": {
            "mimeType": mime,
            "data": encoded,
        }
    }


def google_image_parts_from_request(request: dict[str, Any]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for index, image in enumerate(image_inputs_from_request(request), start=1):
        part = image_reference_to_google_part(image, index)
        if part:
            parts.append(part)
    return parts


def google_aspect_ratio(size: str) -> str:
    match = re.match(r"^\s*(\d+)\s*x\s*(\d+)\s*$", str(size or ""))
    if not match:
        return "1:1"
    width = int(match.group(1))
    height = int(match.group(2))
    if not width or not height:
        return "1:1"
    ratio = width / height
    if ratio < 0.8:
        return "2:3"
    if ratio > 1.25:
        return "3:2"
    return "1:1"


def build_google_text_payload(request: dict[str, Any]) -> dict[str, Any]:
    prompt = str(request.get("prompt", "")).strip()
    system = str(request.get("system", "")).strip()
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts.extend(google_image_parts_from_request(request))
    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
        },
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    return payload


def build_google_image_payload(request: dict[str, Any]) -> dict[str, Any]:
    prompt = str(request.get("prompt", "")).strip()
    size = str(request.get("size") or "1024x1024")
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts.extend(google_image_parts_from_request(request))
    return {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "responseModalities": ["Image"],
            "responseFormat": {
                "image": {
                    "aspectRatio": google_aspect_ratio(size),
                }
            },
        },
    }


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


def generate_google_image(request: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    config = provider_config("google")
    try:
        response = make_google_generate_content(
            build_google_image_payload(request),
            model=str(request.get("imageModel") or config["image_model"]),
            timeout=180,
        )
        image_data = find_image_data(response)
        if image_data:
            return image_data, errors
        errors.append(
            {
                "mode": "google_generate_content",
                "message": "Google Gemini 没有返回图片数据。",
                "raw": response,
            }
        )
    except ProviderError as error:
        errors.append(
            {
                "mode": "google_generate_content",
                "message": str(error),
                "status": error.status,
                "details": error.details,
            }
        )
    return None, errors


def extract_json_payload(text: str) -> dict[str, Any]:
    source = str(text or "").strip()
    source = re.sub(r"^```json\s*", "```", source, flags=re.IGNORECASE)
    fenced = re.search(r"```\s*([\s\S]*?)```", source)
    raw = fenced.group(1).strip() if fenced else source
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("AI 没有返回可解析的 JSON。")
    return json.loads(raw[start : end + 1])


def as_clean_list(value: Any, fallback: list[str] | None = None, limit: int = 8) -> list[str]:
    if isinstance(value, str):
        raw_items = re.split(r"[,，/、\s]+", value)
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = fallback or []
    result: list[str] = []
    for item in raw_items:
        text = str(item or "").strip()
        if text and text not in result:
            result.append(text)
    return result[:limit] or list(fallback or [])[:limit]


def valid_hex_color(value: Any, fallback: str = "#f4eee5") -> str:
    text = str(value or "").strip()
    return text if re.fullmatch(r"#[0-9A-Fa-f]{6}", text) else fallback


def normalize_category(value: Any) -> str:
    category = str(value or "").strip()
    aliases = {
        "上装": "上衣",
        "裤子": "下装",
        "半裙": "下装",
        "裙子": "连衣裙",
        "鞋": "鞋子",
        "包": "包包",
        "包袋": "包包",
    }
    category = aliases.get(category, category)
    return category if category in {"上衣", "下装", "连衣裙", "外套", "鞋子", "包包", "配饰"} else "上衣"


def make_garment_result(metadata: dict[str, Any], image_url: str, file_name: str) -> dict[str, Any]:
    category = normalize_category(metadata.get("category"))
    subcategory = str(metadata.get("subcategory") or category).strip() or category
    seasons = as_clean_list(metadata.get("seasons"), ["春", "夏"], 4)
    styles = as_clean_list(metadata.get("styles"), ["简洁", "休闲"], 8)
    occasions = as_clean_list(metadata.get("occasions"), ["上课", "通勤"], 8)
    primary_color = str(metadata.get("primaryColor") or "待确认").strip() or "待确认"
    pattern = str(metadata.get("pattern") or "待确认").strip() or "待确认"
    color_temperature = str(metadata.get("colorTemperature") or "中性色").strip() or "中性色"
    formality = str(metadata.get("formality") or "休闲").strip() or "休闲"
    visual_weight = str(metadata.get("visualWeight") or "中等").strip() or "中等"
    silhouette = str(metadata.get("silhouette") or subcategory).strip() or subcategory
    tags = as_clean_list(metadata.get("aiTags"), [], 12)
    tag_source = [
        category,
        subcategory,
        primary_color,
        pattern,
        color_temperature,
        formality,
        visual_weight,
        silhouette,
        *[f"{season}季" for season in seasons],
        *styles,
        *occasions,
    ]
    for item in tag_source:
        if item and item not in tags:
            tags.append(item)
    return {
        "id": f"garment-{uuid.uuid4().hex}",
        "name": str(metadata.get("name") or f"新识别单品 {Path(file_name).stem[:8]}").strip(),
        "category": category,
        "subcategory": subcategory,
        "sourceRegion": str(metadata.get("sourceRegion") or "").strip(),
        "seasons": seasons,
        "primaryColor": primary_color,
        "colorHex": valid_hex_color(metadata.get("colorHex")),
        "pattern": pattern,
        "styles": styles,
        "occasions": occasions,
        "notes": str(metadata.get("notes") or "").strip(),
        "aiTags": tags[:16],
        "colorTemperature": color_temperature,
        "formality": formality,
        "visualWeight": visual_weight,
        "silhouette": silhouette,
        "proportionEffect": str(metadata.get("proportionEffect") or "").strip(),
        "confidence": float(metadata.get("confidence") or 0),
        "imagePath": image_url,
        "originalImagePath": image_url,
        "imageStatus": "original",
        "imageError": "",
    }


def call_text_ai(prompt: str, system: str, image_ref: str, ai_mode: str) -> str:
    request = {
        "system": system,
        "prompt": prompt,
        "imageDataUrl": image_ref,
        "reasoningEffort": "xhigh" if ai_mode == "normal" else "medium",
    }
    provider_id = active_provider_id()
    if provider_id == "google":
        response = make_google_generate_content(build_google_text_payload(request), timeout=180 if ai_mode == "normal" else 120)
        return text_from_google_response(response)
    response = make_response_request(build_text_payload(request), timeout=180 if ai_mode == "normal" else 120)
    return text_from_response(response)


def recognize_single_server(image_ref: str, file_name: str, ai_mode: str) -> list[dict[str, Any]]:
    prompt = f"""
识别这张照片中最适合加入电子衣橱的一件服装单品。请优先根据衣物主体判断，不要把人物、背景、姿势当成服装属性。
请输出严格 JSON，不要解释：
{{
  "items": [
    {{
      "name": "简短中文名称",
      "category": "上衣|下装|连衣裙|外套|鞋子|包包|配饰",
      "subcategory": "子类别",
      "sourceRegion": "原图位置，如上半身/脚部/手提区域",
      "seasons": ["春","夏","秋","冬"],
      "primaryColor": "主颜色",
      "colorHex": "#RRGGBB",
      "pattern": "纯色/条纹/格纹/印花/拼接/金属感等",
      "styles": ["简洁","休闲","通勤","甜酷","法式","运动","温柔"],
      "occasions": ["上课","通勤","约会","聚会","旅行","运动"],
      "notes": "一句专业穿搭建议",
      "aiTags": ["短上衣","冷白","轻正式","显腿长"],
      "colorTemperature": "冷色|暖色|中性色|冷中性色",
      "formality": "休闲|中等正式|正式",
      "visualWeight": "轻|中等|中高|重",
      "silhouette": "版型轮廓",
      "proportionEffect": "身材修饰效果",
      "confidence": 0.0
    }}
  ],
  "skipped": []
}}
文件名：{file_name or "未命名图片"}
"""
    text = call_text_ai(prompt, "你是搭一下 App 的高级服装识别与造型标签助手。只输出严格 JSON。", image_ref, ai_mode)
    payload = extract_json_payload(text)
    items = payload.get("items")
    if isinstance(items, list) and items:
        return [item for item in items if isinstance(item, dict)][:1]
    return [payload] if payload else []


def recognize_outfit_server(image_ref: str, file_name: str, ai_mode: str) -> list[dict[str, Any]]:
    max_items = 8 if ai_mode == "normal" else 6
    prompt = f"""
识别这张全身照或穿搭照片里的多件可加入电子衣橱的单品。必须逐区扫描，避免只识别上半身：
1. 头肩和颈部：配饰、帽子、围巾、眼镜；
2. 肩臂外层：外套、开衫、衬衫外搭；
3. 胸腹区域：上衣、背心、T恤、衬衫、卫衣；
4. 腰臀区域：腰线、裙装、裤腰、连衣裙连贯性；
5. 腿部区域：裤子、半裙、连衣裙下摆；
6. 脚部区域：鞋子、靴子、袜子；
7. 手部和身体两侧：包包；
8. 可见小物：配饰。

如果照片里能看到下装或鞋子，即使被遮挡，也要给出低置信度条目并说明 sourceRegion。不要重复同一件衣服。
只输出严格 JSON：
{{
  "items": [
    {{
      "name": "简短中文名称",
      "category": "上衣|下装|连衣裙|外套|鞋子|包包|配饰",
      "subcategory": "子类别",
      "sourceRegion": "原图位置",
      "seasons": ["春","夏","秋","冬"],
      "primaryColor": "主颜色",
      "colorHex": "#RRGGBB",
      "pattern": "图案",
      "styles": ["简洁","休闲","通勤","甜酷","法式","运动","温柔"],
      "occasions": ["上课","通勤","约会","聚会","旅行","运动"],
      "notes": "一句穿搭建议",
      "aiTags": ["高腰","阔腿","冷色","轻正式"],
      "colorTemperature": "冷色|暖色|中性色|冷中性色",
      "formality": "休闲|中等正式|正式",
      "visualWeight": "轻|中等|中高|重",
      "silhouette": "版型轮廓",
      "proportionEffect": "身材修饰效果",
      "confidence": 0.0
    }}
  ],
  "skipped": ["看不清或无法确认的区域"]
}}
最多返回 {max_items} 件。文件名：{file_name or "未命名图片"}
"""
    text = call_text_ai(prompt, "你是搭一下 App 的全身穿搭识别专家。必须按全身区域检查并输出严格 JSON。", image_ref, ai_mode)
    payload = extract_json_payload(text)
    items = payload.get("items", []) if isinstance(payload, dict) else []
    return [item for item in items if isinstance(item, dict)][:max_items]


def image_ref_for_task(task: dict[str, Any]) -> str:
    image_url = str(task.get("imageUrl") or "")
    if image_url and not re.search(r"//(127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)", image_url):
        return image_url
    upload = task.get("upload") or {}
    path = Path(str(upload.get("path") or ""))
    if not path.exists():
        raise RuntimeError("原图文件不存在，可能已被清理。")
    mime = upload.get("mime") or mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def save_ai_image_output(image_data: str, task: dict[str, Any], garment_id: str) -> str:
    image = normalize_data_url(image_data)
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
        content = base64.b64decode(image)
    extension = mimetypes.guess_extension(mime) or ".png"
    if extension == ".jpe":
        extension = ".jpg"
    day = time.strftime("%Y%m%d", time.localtime())
    target_dir = GENERATED_DIR / day
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{task['id']}-{garment_id[:14]}{extension}"
    target.write_bytes(content)
    return absolute_url_for_path(target, str(task.get("publicBaseUrl") or ""))


def generate_task_flat_image(task: dict[str, Any], garment: dict[str, Any], image_ref: str) -> tuple[str | None, str]:
    prompt = f"""
参考上传照片，为电子衣橱生成一张 AI 单品平面图。
只提取这一件衣物：{garment.get("name")}。
类别：{garment.get("category")} / {garment.get("subcategory")}。
原图位置：{garment.get("sourceRegion") or "按名称和类别判断"}。
颜色和图案：{garment.get("primaryColor")}，{garment.get("pattern")}。
要求：单件衣物正面展示，移除人物、皮肤、头发、背景和其他物品；保留真实颜色、版型、长度、材质和图案；暖白或透明感背景；不要文字、水印、模特、衣架。
"""
    request = {
        "prompt": prompt,
        "imageDataUrl": image_ref,
        "size": "1024x1024",
        "quality": "low" if task.get("aiMode") == "fast" else "auto",
        "action": "edit",
        "reasoningEffort": "medium" if task.get("aiMode") == "normal" else "low",
    }
    provider_id = active_provider_id()
    if provider_id == "google":
        image_data, errors = generate_google_image(request)
    else:
        image_data, errors = generate_image_with_fallback(request)
    if not image_data:
        message = errors[-1]["message"] if errors else "AI 没有返回图片"
        return None, message
    return save_ai_image_output(image_data, task, str(garment.get("id") or uuid.uuid4().hex)), ""


def fallback_task_garment(task: dict[str, Any]) -> dict[str, Any]:
    return make_garment_result(
        {
            "name": f"待确认单品 {Path(str(task.get('fileName') or '')).stem[:8]}",
            "category": "上衣",
            "subcategory": "待确认",
            "primaryColor": "待确认",
            "notes": "AI 识别失败，已保留原图，可稍后重试或手动修改。",
            "aiTags": ["待确认"],
        },
        str(task.get("imageUrl") or ""),
        str(task.get("fileName") or ""),
    )


def process_processing_task(task_id: str) -> None:
    with PROCESSING_TASK_LOCK:
        PROCESSING_QUEUED_IDS.discard(task_id)
    task = get_processing_task(task_id)
    if not task or task.get("status") in PROCESSING_TERMINAL_STATUSES:
        return
    try:
        update_processing_task(task_id, {"status": "recognizing", "statusText": "AI 正在识别衣物和标签", "progress": 22})
        image_ref = image_ref_for_task(task)
        file_name = str(task.get("fileName") or "")
        ai_mode = str(task.get("aiMode") or "fast")
        mode = str(task.get("mode") or "single")
        if mode == "outfit":
            metadata_items = recognize_outfit_server(image_ref, file_name, ai_mode)
        else:
            metadata_items = recognize_single_server(image_ref, file_name, ai_mode)

        if not metadata_items:
            raise RuntimeError("没有识别到可加入衣橱的服装。")
        image_url = str(task.get("imageUrl") or "")
        garments = [make_garment_result(item, image_url, file_name) for item in metadata_items]
        update_processing_task(
            task_id,
            {
                "status": "generating" if task.get("generateFlat") else "completed",
                "statusText": f"已识别 {len(garments)} 件，正在生成单品图" if task.get("generateFlat") else f"已识别 {len(garments)} 件",
                "progress": 58 if task.get("generateFlat") else 100,
                "garments": garments,
            },
        )

        if task.get("generateFlat"):
            limit = int(env("TASK_IMAGE_LIMIT_NORMAL" if ai_mode == "normal" else "TASK_IMAGE_LIMIT_FAST", "8" if ai_mode == "normal" else "4"))
            total = max(1, min(len(garments), limit))
            for index, garment in enumerate(garments[:limit], start=1):
                update_processing_task(
                    task_id,
                    {
                        "status": "generating",
                        "statusText": f"生成第 {index}/{total} 件 AI 单品图",
                        "progress": min(92, 58 + int(index / total * 34)),
                    },
                )
                try:
                    output_url, image_error = generate_task_flat_image(task, garment, image_ref)
                    if output_url:
                        garment["imagePath"] = output_url
                        garment["imageStatus"] = "done"
                        garment["imageError"] = ""
                    else:
                        garment["imageStatus"] = "failed"
                        garment["imageError"] = image_error
                except Exception as image_error:
                    garment["imageStatus"] = "failed"
                    garment["imageError"] = str(image_error)
            if len(garments) > limit:
                for garment in garments[limit:]:
                    garment["imageStatus"] = "queued"
                    garment["imageError"] = "为提升速度，本次先保留原图；可在衣橱详情中重生单品图。"

        update_processing_task(
            task_id,
            {
                "status": "completed",
                "statusText": f"已完成：{len(garments)} 件单品",
                "progress": 100,
                "garments": garments,
                "error": "",
            },
        )
    except Exception as error:
        fallback = fallback_task_garment(task)
        update_processing_task(
            task_id,
            {
                "status": "failed",
                "statusText": "处理失败，已保留原图",
                "progress": 100,
                "garments": [fallback],
                "error": str(error),
            },
        )


def processing_worker_loop() -> None:
    while True:
        task_id = PROCESSING_QUEUE.get()
        try:
            process_processing_task(task_id)
        except Exception as error:
            print("Processing worker failed:", task_id, error)
        finally:
            PROCESSING_QUEUE.task_done()


def ensure_processing_workers() -> None:
    global PROCESSING_WORKERS_STARTED
    with PROCESSING_TASK_LOCK:
        if PROCESSING_WORKERS_STARTED:
            return
        PROCESSING_WORKERS_STARTED = True
        worker_count = max(1, min(4, int(env("PROCESSING_WORKERS", "1"))))
        for index in range(worker_count):
            worker = threading.Thread(target=processing_worker_loop, name=f"styletap-processing-{index + 1}", daemon=True)
            worker.start()


def requeue_unfinished_processing_tasks() -> None:
    load_processing_tasks()
    with PROCESSING_TASK_LOCK:
        task_ids = [
            task_id
            for task_id, task in PROCESSING_TASKS.items()
            if task.get("status") not in PROCESSING_TERMINAL_STATUSES
        ]
    for task_id in task_ids:
        enqueue_processing_task(task_id)


def cleanup_worker_loop() -> None:
    interval = max(300, int(env("CLEANUP_INTERVAL_SECONDS", "1800")))
    while True:
        time.sleep(interval)
        try:
            cleanup_processing_storage()
        except Exception as error:
            print("Processing cleanup failed:", error)


def ensure_cleanup_worker() -> None:
    global CLEANUP_THREAD_STARTED
    with PROCESSING_TASK_LOCK:
        if CLEANUP_THREAD_STARTED:
            return
        CLEANUP_THREAD_STARTED = True
        worker = threading.Thread(target=cleanup_worker_loop, name="styletap-cleanup", daemon=True)
        worker.start()


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
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/processing/tasks":
            ids = [
                item.strip()
                for value in query.get("ids", [])
                for item in value.split(",")
                if item.strip()
            ]
            json_response(self, 200, {"ok": True, "tasks": list_processing_tasks(ids or None)})
            return

        if path == "/api/processing/task":
            task_id = (query.get("id") or [""])[0].strip()
            task = get_processing_task(task_id)
            if not task:
                json_response(self, 404, {"ok": False, "error": "Processing task not found."})
                return
            json_response(self, 200, {"ok": True, "task": task})
            return

        if path == "/api/database":
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

        if path == "/api/config":
            provider_id = active_provider_id()
            config = provider_config(provider_id)
            providers = []
            for item in ("openai", "google"):
                item_config = provider_config(item)
                providers.append(
                    {
                        "id": item,
                        "label": provider_label(item),
                        "baseUrl": item_config["base_url"],
                        "model": item_config["model"],
                        "imageModel": item_config["image_model"],
                        "hasApiKey": bool(api_key(item)),
                        "apiKeyCount": api_key_count(item),
                        "keySource": api_key_source(item),
                    }
                )
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "provider": config["label"],
                    "providerId": provider_id,
                    "providers": providers,
                    "baseUrl": config["base_url"],
                    "model": config["model"],
                    "imageModel": config["image_model"],
                    "reasoningEffort": config["reasoning_effort"],
                    "hasApiKey": bool(api_key(provider_id)),
                    "keySource": api_key_source(provider_id),
                    "apiKeyCount": api_key_count(provider_id),
                    "runtimeApiKeyEnabled": runtime_api_key_enabled(),
                    "serverDatabaseEnabled": server_database_enabled(),
                    "wechat": wechat_public_config(),
                    "processing": {
                        "asyncUploadEnabled": True,
                        "maxUploadCount": 10,
                        "maxUploadBytes": int(env("MAX_IMAGE_UPLOAD_BYTES", "30000000")),
                        "workerCount": int(env("PROCESSING_WORKERS", "1")),
                        "uploadRetentionSeconds": int(env("UPLOAD_RETENTION_SECONDS", "3600")),
                        "generatedRetentionSeconds": int(env("GENERATED_RETENTION_SECONDS", "86400")),
                        "clientAckCleanupEnabled": True,
                    },
                    "responseStorageDisabled": True,
                },
            )
            return

        if path == "/api/wechat/config":
            json_response(self, 200, {"ok": True, **wechat_public_config()})
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        super().do_GET()

    def do_POST(self) -> None:
        global RUNTIME_PROVIDER, RUNTIME_API_KEYS
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/processing/upload":
                fields, files = parse_multipart_form(self)
                file = next((item for item in files if item.get("field") == "file"), files[0] if files else None)
                if not file:
                    json_response(self, 400, {"ok": False, "error": "Missing upload file."})
                    return
                base_url = public_base_url(self)
                upload = save_uploaded_image(file, base_url)
                task = create_processing_task(upload, fields, base_url)
                json_response(self, 200, {"ok": True, "upload": upload, "task": task})
                return

            request = read_json(self)
            if path == "/api/key":
                if not runtime_api_key_enabled():
                    json_response(
                        self,
                        200,
                        {
                            "ok": False,
                            "error": "线上部署不接受网页临时 API Key。请在服务器环境变量中配置 OPENAI_API_KEY(S) 或 GOOGLE_API_KEY(S)，并用 AI_PROVIDER 选择提供方。",
                            "hasApiKey": bool(api_key(active_provider_id())),
                            "keySource": api_key_source(active_provider_id()),
                            "apiKeyCount": api_key_count(active_provider_id()),
                        },
                    )
                    return
                provider_id = normalize_provider(str(request.get("provider") or active_provider_id()))
                candidates = split_env_values(str(request.get("apiKey", "")).strip())
                if not candidates:
                    json_response(self, 400, {"ok": False, "error": "Missing API key."})
                    return
                RUNTIME_PROVIDER = provider_id
                RUNTIME_API_KEYS = []
                add_unique_keys(RUNTIME_API_KEYS, candidates)
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "hasApiKey": True,
                        "provider": provider_label(provider_id),
                        "providerId": provider_id,
                        "keySource": "runtime",
                        "apiKeyCount": api_key_count(provider_id),
                    },
                )
                return

            if path == "/api/database":
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

            if path == "/api/processing/tasks":
                uploads = request.get("uploads")
                if not isinstance(uploads, list) or not uploads:
                    json_response(self, 400, {"ok": False, "error": "Missing uploads."})
                    return
                base_url = public_base_url(self)
                fields = {
                    "mode": str(request.get("mode") or "single"),
                    "aiMode": str(request.get("aiMode") or "fast"),
                    "generateFlat": str(request.get("generateFlat", "true")),
                }
                tasks = [create_processing_task(upload, fields, base_url) for upload in uploads if isinstance(upload, dict)]
                json_response(self, 200, {"ok": True, "tasks": tasks})
                return

            if path == "/api/processing/ack":
                task_ids = request.get("taskIds") or request.get("ids") or []
                if isinstance(task_ids, str):
                    task_ids = [item.strip() for item in task_ids.split(",") if item.strip()]
                if not isinstance(task_ids, list) or not task_ids:
                    json_response(self, 400, {"ok": False, "error": "Missing taskIds."})
                    return
                result = ack_processing_tasks([str(item) for item in task_ids if str(item).strip()])
                json_response(self, 200, {"ok": True, **result})
                return

            if path == "/api/processing/cleanup":
                force = bool(request.get("force"))
                cleanup_token = env("CLEANUP_TOKEN")
                if force and cleanup_token and str(request.get("token") or "") != cleanup_token:
                    json_response(self, 403, {"ok": False, "error": "Invalid cleanup token."})
                    return
                if force and not cleanup_token:
                    json_response(self, 403, {"ok": False, "error": "Force cleanup requires CLEANUP_TOKEN."})
                    return
                result = cleanup_processing_storage(force=force)
                json_response(self, 200, {"ok": True, **result})
                return

            if path == "/api/wechat/login":
                code = str(request.get("code", "")).strip()
                if not code:
                    json_response(self, 400, {"ok": False, "error": "Missing wx.login code."})
                    return
                session = wechat_code2session(code)
                token = make_wechat_session_token(session)
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "sessionToken": token,
                        "user": {
                            "id": wechat_user_id(session["openid"]),
                            "hasUnionId": bool(session.get("unionid")),
                        },
                    },
                )
                return

            if path == "/api/wechat/pay/create":
                payment = create_wechat_payment_params(request)
                json_response(self, 200, {"ok": True, **payment})
                return

            if path == "/api/wechat/pay/notify":
                # MVP only records that a notification endpoint exists. Do not grant paid
                # entitlements here until WeChat Pay platform-certificate verification and
                # encrypted resource decryption are implemented with an order table.
                print("WeChat Pay notify received:", json.dumps(strip_secret_fields(request), ensure_ascii=False))
                json_response(self, 200, {"code": "SUCCESS", "message": "成功"})
                return

            if path == "/api/text":
                if not str(request.get("prompt", "")).strip():
                    json_response(self, 400, {"ok": False, "error": "Missing prompt."})
                    return
                provider_id = active_provider_id()
                if provider_id == "google":
                    response = make_google_generate_content(build_google_text_payload(request), timeout=120)
                    json_response(self, 200, {"ok": True, "text": text_from_google_response(response), "raw": response})
                else:
                    response = make_response_request(build_text_payload(request))
                    json_response(self, 200, {"ok": True, "text": text_from_response(response), "raw": response})
                return

            if path == "/api/image":
                if not str(request.get("prompt", "")).strip():
                    json_response(self, 400, {"ok": False, "error": "Missing prompt."})
                    return
                provider_id = active_provider_id()
                if provider_id == "google":
                    image_data, image_errors = generate_google_image(request)
                else:
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
        global RUNTIME_PROVIDER, RUNTIME_API_KEYS
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/database":
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

        if path == "/api/key":
            if not runtime_api_key_enabled():
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "hasApiKey": bool(api_key(active_provider_id())),
                        "keySource": api_key_source(active_provider_id()),
                        "apiKeyCount": api_key_count(active_provider_id()),
                        "runtimeApiKeyEnabled": False,
                    },
                )
                return
            RUNTIME_PROVIDER = ""
            RUNTIME_API_KEYS = []
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "hasApiKey": bool(api_key(active_provider_id())),
                    "keySource": api_key_source(active_provider_id()),
                    "apiKeyCount": api_key_count(active_provider_id()),
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
    ensure_processing_workers()
    ensure_cleanup_worker()
    requeue_unfinished_processing_tasks()
    cleanup_processing_storage()
    server = ThreadingHTTPServer((host, port), StyleTapHandler)
    print(f"StyleTap server running at http://{host}:{port}")
    if host == "0.0.0.0":
        print(f"LAN access enabled. Other devices should use this computer's LAN IP, for example http://192.168.x.x:{port}")
    print("Active AI provider:", provider_label(active_provider_id()))
    print("OpenAI API key count:", api_key_count("openai"))
    print("Google API key count:", api_key_count("google"))
    server.serve_forever()


if __name__ == "__main__":
    run()
