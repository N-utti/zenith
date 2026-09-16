"""04 §9 `GET /metrics` — Prometheus 텍스트 포맷(counter·gauge 몇 개)을 손으로 쓴다.

인증이 없다. 스크레이퍼(아직 없음 — Prometheus 를 넣을지는 파일럿 때 결정)는 compose 안에서 `api:8000/api/metrics`
를 긁고, 바깥은 caddy 가 `/api/metrics` 를 404 로 막는다(infra/caddy/Caddyfile). 값은 프로세스 메모리(worker 1개 전제).
ponytail: prometheus-client 는 히스토그램·멀티프로세스가 필요해질 때. 지금은 요청 수·소켓 수·풀 사용량이면 된다.
"""

import time
from collections import Counter

from app.db import engine
from app.realtime import chat, yjs

STARTED = time.time()
# (method, status) → 응답 수. /api/* 만 센다(main.py 미들웨어).
REQUESTS: Counter[tuple[str, int]] = Counter()


def observe(method: str, status: int) -> None:
    REQUESTS[(method, status)] += 1


def render() -> str:
    lines = ["# TYPE zenith_http_requests_total counter"]
    for (method, status), n in sorted(REQUESTS.items()):
        lines.append(f'zenith_http_requests_total{{method="{method}",status="{status}"}} {n}')
    lines += [
        "# TYPE zenith_ws_connections gauge",
        f"zenith_ws_connections {sum(len(s) for s in chat.SOCKETS.values())}",
        "# TYPE zenith_yjs_rooms gauge",
        f"zenith_yjs_rooms {len(yjs.ROOMS)}",
        "# TYPE zenith_db_pool_checked_out gauge",
        f"zenith_db_pool_checked_out {engine.pool.checkedout()}",
        "# TYPE zenith_db_pool_max gauge",  # 분모 — pool_size + max_overflow(기본 5+10). overflow() 는 상대값이라 안 쓴다
        f"zenith_db_pool_max {engine.pool.size() + engine.pool._max_overflow}",
        "# TYPE process_start_time_seconds gauge",
        f"process_start_time_seconds {STARTED:.0f}",
    ]
    return "\n".join(lines) + "\n"
