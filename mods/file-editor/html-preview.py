"""Serve one HTML file and its project assets to a local browser."""
import http.server
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit

# Herdr core caps command stdout at 8 MiB. Read one extra byte to detect oversize assets.
MAX_ASSET = 8 * 1024 * 1024 - 1
IDLE = 15 * 60
WIDTH, HEIGHT = 1080, 1440
CSP = ("sandbox allow-same-origin; default-src 'none'; "
       "img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:")
READ_REMOTE = '''
root=$(realpath -- "$1") && file=$(realpath -- "$2") || exit 1
case "$file" in "${root%/}/"*) ;; *) exit 1 ;; esac
[ -f "$file" ] && head -c "$3" "$file"
'''


class Project:
    def __init__(self, path, machine, draft=None):
        self.machine = machine
        self.path = PurePosixPath(path) if machine else Path(path).resolve()
        self.root = self.path.parent
        self.draft = Path(draft) if draft else None
        git = self.command("git", "-C", str(self.root), "rev-parse", "--show-toplevel")
        try:
            root = subprocess.check_output(git, stderr=subprocess.DEVNULL, timeout=6).decode().rstrip("\n")
            candidate = type(self.path)(root)
            if candidate.is_absolute() and self.path.is_relative_to(candidate):
                self.root = candidate
        except (OSError, subprocess.SubprocessError, UnicodeError):
            pass

    def command(self, *args):
        if self.machine:
            return ["hc", "exec", "--on", self.machine, "--timeout", "6", "--", *args]
        return list(args)

    def read(self, relative):
        if not relative or any(p in ("", ".", "..") or "\\" in p for p in relative.split("/")):
            raise FileNotFoundError
        file = self.root / relative
        if self.draft and file == self.path:
            return self.draft.read_bytes()
        if self.machine:
            data = subprocess.check_output(
                self.command("sh", "-c", READ_REMOTE, "html-preview", str(self.root), str(file), str(MAX_ASSET + 1)),
                stderr=subprocess.DEVNULL, timeout=8,
            )
        else:
            file = file.resolve()
            if not file.is_relative_to(self.root) or not file.is_file():
                raise FileNotFoundError
            with file.open("rb") as stream:
                data = stream.read(MAX_ASSET + 1)
        if len(data) > MAX_ASSET:
            raise FileNotFoundError
        return data


class Server(http.server.ThreadingHTTPServer):
    def __init__(self, project, static):
        super().__init__(("127.0.0.1", 0), Request)
        self.project, self.static = project, static
        self.host = f"127.0.0.1:{self.server_port}"
        self.cookie = f"herdr_html_{self.server_port}"
        self.token = secrets.token_urlsafe(24)
        self.last = time.monotonic()
        route = quote(project.path.relative_to(project.root).as_posix())
        self.url = f"http://{self.host}/{route}?__herdr_preview={self.token}"


class Request(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        parts = urlsplit(self.path)
        cookies = (c.strip() for c in self.headers.get("Cookie", "").split(";"))
        ticket = parse_qs(parts.query).get("__herdr_preview") == [self.server.token]
        allowed = f"{self.server.cookie}={self.server.token}" in cookies
        if self.headers.get("Host") != self.server.host or not (ticket or allowed):
            self.send_error(404)
            return
        self.server.last = time.monotonic()
        relative = unquote(parts.path).removeprefix("/")
        try:
            data = self.server.project.read(relative)
        except (OSError, ValueError, subprocess.SubprocessError):
            self.send_error(404)
            return
        mime = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        if mime == "text/html" and self.server.static:
            mime += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if ticket:
            self.send_header("Set-Cookie", f"{self.server.cookie}={self.server.token}; Path=/; HttpOnly; SameSite=Strict")
        if self.server.static:
            self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


def chrome(home):
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome", "msedge"):
        if executable := shutil.which(name):
            return executable
    for folder in (Path("/Applications"), Path(home) / "Applications"):
        for name in ("Google Chrome", "Chromium", "Brave Browser", "Microsoft Edge"):
            executable = folder / f"{name}.app/Contents/MacOS/{name}"
            if os.access(executable, os.X_OK):
                return str(executable)
    raise RuntimeError("Install Chrome or Chromium on this desktop for HTML snapshots.")


def snapshot(path, machine, draft, output, home):
    browser = chrome(home)
    with Server(Project(path, machine, draft), static=True) as server, tempfile.TemporaryDirectory() as profile:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            subprocess.run([
                browser, "--headless", f"--user-data-dir={profile}", "--disable-extensions",
                "--no-first-run", "--no-proxy-server", "--hide-scrollbars",
                f"--window-size={WIDTH},{HEIGHT}", f"--screenshot={output}/page.png", server.url,
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=24)
        finally:
            server.shutdown()
    print(json.dumps({"width": WIDTH, "height": HEIGHT}))


def serve(path, machine):
    with Server(Project(path, machine), static=False) as server:
        print(server.url, flush=True)
        sys.stdout.close()
        server.timeout = 15
        while time.monotonic() - server.last < IDLE:
            server.handle_request()


def browser(path, machine):
    # The browser can reload the page while the private loopback server is in use.
    with subprocess.Popen(
        [sys.executable, __file__, "serve", path, machine],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        start_new_session=True, text=True,
    ) as process:
        url = process.stdout.readline().strip()
        if not url:
            raise RuntimeError("Could not start the HTML preview server.")
        print(url, flush=True)
        # Leave the helper alive for the browser. Popen's context manager would wait for it.
        os._exit(0)


if __name__ == "__main__":
    try:
        {"browser": browser, "snapshot": snapshot, "serve": serve}[sys.argv[1]](*sys.argv[2:])
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
