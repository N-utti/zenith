"""구형 .hwp → XML 변환 서버(표준 라이브러리만). POST /convert 에 hwp 바이트를 보내면
`hwp5proc xml --embedbin` 결과(그림은 base64 로 안에)를 application/xml 로 돌려준다. GET /health 는 200.

한계는 api 쪽과 같다: 본문 10MB, 변환 60초. 이 서버는 compose 망 안에서만 보이고 인증이 없다 —
호스트 포트를 열지 않는다. 변환은 자식 프로세스라 pyhwp 가 죽어도 서버는 산다.
"""

import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_S = 60


class Handler(BaseHTTPRequestHandler):
    server_version = "zenith-hwp/1"

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
        if length <= 0 or length > MAX_BYTES:
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
                tail = proc.stderr[-2000:] if proc.stderr else b""
                return self._send(422, b"not hwp5: " + tail)
            with open(out, "rb") as f:
                xml = f.read()
        self._send(200, xml, "application/xml")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
