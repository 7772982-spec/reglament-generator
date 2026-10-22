"""Маленький локальный сервер генератора регламентов.

Показывает страницу index.html и сохраняет готовые регламенты
в папку «Готовые регламенты» рядом с папкой «Генератор».
Работает только на этом компьютере (127.0.0.1) и сам выключается,
если им не пользуются 3 часа.
"""
import json
import os
import re
import subprocess
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8765
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "Готовые регламенты")
IDLE_LIMIT = 3 * 60 * 60

last_activity = time.time()


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|\n\r\t]+', " ", name).strip()
    name = re.sub(r"\s+", " ", name)[:120]
    return name or "Регламент"


def unique_path(base):
    path = os.path.join(OUT_DIR, base + ".txt")
    n = 2
    while os.path.exists(path):
        path = os.path.join(OUT_DIR, "%s (%d).txt" % (base, n))
        n += 1
    return path


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, *args):
        pass

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global last_activity
        last_activity = time.time()
        if self.path == "/ping":
            return self.send_json(200, {"ok": True})
        if self.path in ("/", ""):
            self.path = "/index.html"
        if self.path != "/index.html":
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        global last_activity
        last_activity = time.time()
        # Защита: принимаем запросы только от своей страницы.
        if self.headers.get("X-Reglament") != "1":
            return self.send_error(403)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except ValueError:
            return self.send_error(400)

        if self.path == "/save":
            os.makedirs(OUT_DIR, exist_ok=True)
            path = unique_path(safe_name(str(data.get("name", ""))))
            with open(path, "w", encoding="utf-8") as f:
                f.write(str(data.get("text", "")))
            return self.send_json(200, {"ok": True, "path": path, "file": os.path.basename(path)})

        if self.path == "/open":
            target = OUT_DIR
            file = data.get("file")
            if file:
                candidate = os.path.join(OUT_DIR, os.path.basename(str(file)))
                if os.path.exists(candidate):
                    target = candidate
            if target.endswith(".txt"):
                subprocess.Popen(["open", "-e", target])  # открыть в TextEdit
            else:
                subprocess.Popen(["open", target])
            return self.send_json(200, {"ok": True})

        return self.send_error(404)


def idle_watch(server):
    while True:
        time.sleep(60)
        if time.time() - last_activity > IDLE_LIMIT:
            server.shutdown()
            return


if __name__ == "__main__":
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=idle_watch, args=(httpd,), daemon=True).start()
    httpd.serve_forever()
