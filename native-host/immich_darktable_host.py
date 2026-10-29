#!/usr/bin/env python3
"""Native messaging host: fetch Immich originals and open them in darktable.

Protocol (Chrome native messaging): 4-byte native-endian length + UTF-8 JSON, both ways.
Uses only the standard library.
"""
import json
import logging
import os
import re
import shlex
import shutil
import ssl
import struct
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LOG_DIR = Path.home() / ".cache" / "immich-darktable"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    filename=LOG_DIR / "host.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("immich-darktable")

UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    (length,) = struct.unpack("@I", raw_len)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


class Immich:
    def __init__(self, server, auth, insecure_tls):
        self.server = server.rstrip("/")
        self.headers = {"Accept": "application/json"}
        if auth.get("apiKey"):
            self.headers["x-api-key"] = auth["apiKey"]
        elif auth.get("token"):
            self.headers["x-immich-user-token"] = auth["token"]
        self.ctx = ssl._create_unverified_context() if insecure_tls else None

    def _open(self, path):
        req = urllib.request.Request(self.server + path, headers=self.headers)
        return urllib.request.urlopen(req, context=self.ctx, timeout=60)

    def asset(self, asset_id):
        with self._open(f"/api/assets/{asset_id}") as resp:
            return json.load(resp)

    def download_original(self, asset_id, dest):
        tmp = dest.with_name(dest.name + ".part")
        with self._open(f"/api/assets/{asset_id}/original") as resp, open(tmp, "wb") as f:
            shutil.copyfileobj(resp, f, length=1024 * 1024)
        tmp.replace(dest)


def safe_filename(name, asset_id):
    name = re.sub(r"[/\\\x00]", "_", name).strip() or asset_id
    stem, ext = os.path.splitext(name)
    # Asset id suffix keeps same-named files from different assets apart, and makes
    # re-opening the same asset reuse the earlier copy (and its darktable XMP sidecar).
    return f"{stem}__{asset_id[:8]}{ext}"


def map_local_path(original_path, mappings):
    for m in mappings or []:
        src = m.get("from", "").rstrip("/")
        if src and (original_path == src or original_path.startswith(src + "/")):
            local = Path(os.path.expanduser(m["to"].rstrip("/") + original_path[len(src):]))
            if local.is_file():
                return local
    return None


def darktable_command(setting):
    if setting and setting != "auto":
        return shlex.split(os.path.expanduser(setting))
    if shutil.which("darktable"):
        return ["darktable"]
    if shutil.which("flatpak"):
        ok = subprocess.run(
            ["flatpak", "info", "org.darktable.Darktable"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0
        if ok:
            return ["flatpak", "run", "org.darktable.Darktable"]
    raise RuntimeError("darktable not found (not on PATH and no Flatpak). Set the command in the extension options.")


def gui_env():
    """When spawned via flatpak-spawn the display variables can be missing; borrow them from systemd."""
    env = dict(os.environ)
    if env.get("WAYLAND_DISPLAY") or env.get("DISPLAY"):
        return env
    try:
        out = subprocess.run(
            ["systemctl", "--user", "show-environment"], capture_output=True, text=True, timeout=5
        ).stdout
        for line in out.splitlines():
            key, _, value = line.partition("=")
            if key in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"):
                env.setdefault(key, value)
    except Exception:
        log.exception("could not read systemd user environment")
    return env


def handle_open(msg):
    ids = [i for i in msg.get("assetIds", []) if UUID_RE.match(str(i))]
    if not ids:
        return {"ok": False, "error": "No valid asset ids received"}

    immich = Immich(msg["server"], msg.get("auth", {}), msg.get("insecureTls", False))
    download_dir = Path(os.path.expanduser(msg.get("downloadDir") or "~/Pictures/Immich-darktable"))
    download_dir.mkdir(parents=True, exist_ok=True)
    cmd = darktable_command(msg.get("darktableCommand"))

    files, skipped = [], []
    for asset_id in ids:
        try:
            info = immich.asset(asset_id)
            if info.get("type") != "IMAGE":
                skipped.append({"id": asset_id, "reason": f"{info.get('type', 'unknown').lower()} is not an image"})
                continue
            local = map_local_path(info.get("originalPath", ""), msg.get("pathMappings"))
            if local is None:
                local = download_dir / safe_filename(info.get("originalFileName") or asset_id, asset_id)
                if not local.is_file() or local.stat().st_size == 0:
                    log.info("downloading %s -> %s", asset_id, local)
                    immich.download_original(asset_id, local)
            files.append(str(local))
        except urllib.error.HTTPError as e:
            reason = "not authorised (log in again or check the API key)" if e.code in (401, 403) else f"HTTP {e.code}"
            skipped.append({"id": asset_id, "reason": reason})
        except Exception as e:
            log.exception("asset %s failed", asset_id)
            skipped.append({"id": asset_id, "reason": str(e)})

    if not files:
        return {"ok": False, "error": "; ".join(f"{s['id'][:8]}: {s['reason']}" for s in skipped) or "nothing to open"}

    log.info("launching %s with %d file(s)", cmd, len(files))
    # New session + no inherited stdio, so darktable outlives this host and never writes into the browser pipe.
    subprocess.Popen(
        cmd + files,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=open(LOG_DIR / "darktable.log", "ab"),
        start_new_session=True,
        env=gui_env(),
    )
    return {"ok": True, "opened": files, "skipped": skipped}


def main():
    msg = read_message()
    if msg is None:
        return
    try:
        if msg.get("action") == "open":
            result = handle_open(msg)
        elif msg.get("action") == "ping":
            result = {"ok": True}
        else:
            result = {"ok": False, "error": f"unknown action {msg.get('action')!r}"}
    except Exception as e:
        log.exception("request failed")
        result = {"ok": False, "error": str(e)}
    send_message(result)


if __name__ == "__main__":
    main()
