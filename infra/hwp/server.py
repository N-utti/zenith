"""구형 .hwp → XML 변환 서버(표준 라이브러리만). POST /convert 에 hwp 바이트를 보내면
`hwp5proc xml --embedbin` 결과(그림은 base64 로 안에)를 application/xml 로 돌려준다. GET /health 는 200.

한계는 api 쪽과 같다: 본문 10MB, 변환 60초. 이 서버는 compose 망 안에서만 보이고 인증이 없다 —
호스트 포트를 열지 않는다. 변환은 자식 프로세스라 pyhwp 가 죽어도 서버는 산다.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 10 * 1024 * 1024
MAX_OUT_BYTES = 40 * 1024 * 1024  # api 는 32MB 에서 끊는다 — 그 전에 수백 MB 를 만들어 메모리를 터뜨리지 않게(리뷰)
TIMEOUT_S = 45  # api 의 55초·라우터의 60초보다 먼저 끝나야 504 가 전해진다(리뷰)


class Handler(BaseHTTPRequestHandler):
    server_version = "zenith-hwp/1"
    timeout = 30  # 헤더만 보내고 멈춘 연결이 스레드를 영영 쥐지 않게(리뷰)

    def log_message(self, fmt, *args):  # 요청 로그는 상태 코드만 — 파일 이름·내용은 남기지 않는다
        print(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}", flush=True)

    def _send(self, code: int, body: bytes, ctype: str = "text/plain; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 — http.server 규약
        if self.path == "/health":
            return self._send(200, b"ok")
        self._send(404, b"not found")

    def do_POST(self):  # noqa: N802
        if self.path != "/convert":
            return self._send(404, b"not found")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, b"bad length")
        if length <= 0:
            return self._send(411, b"length required")
        if length > MAX_BYTES:
            return self._send(413, b"too large")
        data = self.rfile.read(length)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in.hwp")
            out = os.path.join(tmp, "out.xml")
            with open(src, "wb") as f:
                f.write(data)
            try:
                proc = subprocess.run(
                    ["hwp5proc", "xml", "--embedbin", "--no-validate-wellformed", "--output", out, src],
                    capture_output=True,
                    timeout=TIMEOUT_S,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                return self._send(504, b"timeout")
            if proc.returncode != 0 or not os.path.exists(out):
                # 원인은 서버 로그에만 — 응답 본문에 traceback·임시 경로를 싣지 않는다(리뷰)
                print((proc.stderr or b"")[-2000:].decode("utf-8", "replace"), file=sys.stderr, flush=True)
                return self._send(422, b"not hwp5")
            size = os.path.getsize(out)
            if size > MAX_OUT_BYTES:
                return self._send(413, b"output too large")
            self.send_response(200)
            self.send_header("Content-Type", "application/xml")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(out, "rb") as f:
                shutil.copyfileobj(f, self.wfile)  # 메모리에 통째로 올리지 않는다


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
