#!/usr/bin/env python3
"""Read one YouTube live chat into the bridge's atomic session JSON format."""

import atexit
import json
import os
from pathlib import Path
import signal
import sys
import time

import httpx

# pytchat creates internal clients without a timeout override. Keep slow WSL
# handshakes bounded without modifying site packages.
_original_client_init = httpx.Client.__init__


def _client_init(self, *args, **kwargs):
    kwargs.setdefault("timeout", 30.0)
    return _original_client_init(self, *args, **kwargs)


httpx.Client.__init__ = _client_init

import pytchat  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
VIDEO_ID = os.environ.get("YT_VIDEO_ID", "").strip()
OUTPUT = Path(os.environ.get("CHAT_SESSION_FILE", ROOT / "state" / "live-session.json"))
LOCK_FILE = Path(os.environ.get("YT_CHAT_LOCK_FILE", "/tmp/vcv-chat-live-reader.lock"))
MAX_HISTORY = 100

if len(VIDEO_ID) != 11 or not all(character.isalnum() or character in "_-" for character in VIDEO_ID):
    print("[chat-reader] YT_VIDEO_ID must be an 11-character YouTube video ID", flush=True)
    raise SystemExit(2)

lock_fd = None
lock_owned = False
history = []


def release_lock():
    global lock_fd, lock_owned
    if not lock_owned:
        return
    if lock_fd is not None:
        try:
            os.close(lock_fd)
        except OSError:
            pass
        lock_fd = None
    try:
        LOCK_FILE.unlink()
    except FileNotFoundError:
        pass
    lock_owned = False


def acquire_lock():
    global lock_fd, lock_owned
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            lock_fd = os.open(LOCK_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.write(lock_fd, f"{os.getpid()}\n".encode())
            lock_owned = True
            atexit.register(release_lock)
            return
        except FileExistsError:
            try:
                owner_pid = int(LOCK_FILE.read_text(encoding="utf-8").strip())
            except (OSError, ValueError):
                owner_pid = 0
            if owner_pid > 0:
                try:
                    os.kill(owner_pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise RuntimeError(f"another chat reader is active (PID {owner_pid})")
            try:
                LOCK_FILE.unlink()
            except FileNotFoundError:
                pass
    raise RuntimeError("could not acquire the chat-reader lock")


def write_session(active=True, error=None):
    payload = {
        "active": active,
        "videoId": VIDEO_ID,
        "liveChatId": VIDEO_ID,
        "chatHistory": history[-MAX_HISTORY:],
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if error:
        payload["error"] = str(error)[:240]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_name(f"{OUTPUT.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(OUTPUT)


def shutdown(_signal, _frame):
    print("[chat-reader] shutting down", flush=True)
    write_session(active=False)
    release_lock()
    raise SystemExit(0)


signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

try:
    acquire_lock()
except RuntimeError as error:
    print(f"[chat-reader] {error}", flush=True)
    raise SystemExit(1)

print(f"[chat-reader] video={VIDEO_ID}", flush=True)
print(f"[chat-reader] session={OUTPUT}", flush=True)

client = httpx.Client(http2=True, timeout=30.0)
chat = None
for attempt in range(6):
    try:
        chat = pytchat.create(video_id=VIDEO_ID, client=client)
        break
    except Exception as error:  # network/library failures are retried and logged
        print(f"[chat-reader] connect attempt {attempt + 1} failed: {type(error).__name__}", flush=True)
        time.sleep(5 * (attempt + 1))

if chat is None:
    write_session(active=False, error="could not connect to live chat")
    raise SystemExit(1)

print(f"[chat-reader] alive={chat.is_alive()}", flush=True)
write_session()
last_write = time.monotonic()

while chat.is_alive():
    try:
        items = chat.get().sync_items()
        for item in items:
            text = item.message or ""
            if not text:
                continue
            history.append({
                "id": str(getattr(item, "id", "") or ""),
                "name": item.author.name or "viewer",
                "channelId": str(getattr(item.author, "channelId", "") or ""),
                "text": text,
                "ts": getattr(item, "timestamp", None) or int(time.time() * 1000),
                "isChatOwner": bool(getattr(item.author, "isChatOwner", False)),
                "isChatModerator": bool(getattr(item.author, "isChatModerator", False)),
                "isChatSponsor": bool(getattr(item.author, "isChatSponsor", False)),
            })
            print(f"[chat-reader] {item.author.name or 'viewer'}: {text[:80]}", flush=True)
        if items or time.monotonic() - last_write >= 10:
            write_session()
            last_write = time.monotonic()
    except Exception as error:
        print(f"[chat-reader] poll failed: {type(error).__name__}", flush=True)
    time.sleep(2)

print("[chat-reader] chat ended", flush=True)
write_session(active=False)
