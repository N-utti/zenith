"""AI 답변 생성을 SSE 연결에서 뗀다(README 58).

`POST /ai/chat` 은 생성을 태스크로 띄우고 그 이벤트를 흘려 줄 뿐이라, 클라이언트가 화면을 떠나(새로고침·앱 종료)
연결이 끊겨도 서버는 답을 끝까지 만들어 저장한다. 돌아온 클라이언트는 `GET /ai/sessions/{id}/stream` 으로
지금까지의 이벤트부터 이어 받는다.

ponytail: 프로세스 메모리(worker 1개 전제 — 스로틀·소켓과 같다). worker 가 늘면 Redis 스트림으로.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

from app.errors import ApiError

Event = tuple[str, object]  # (SSE event 이름, data)


@dataclass
class Job:
    session_id: uuid.UUID
    user_id: uuid.UUID
    message: str  # 질문 — 돌아온 화면이 답 위에 그릴 것
    model: str  # 세션의 모델명 — 목록이 DB 없이 그린다
    started_at: datetime
    events: list[Event] = field(default_factory=list)  # 늦게 붙은 구독자에게 처음부터 되돌려 준다
    done: bool = False
    task: asyncio.Task | None = None
    _changed: asyncio.Event = field(default_factory=asyncio.Event)

    def push(self, event: str, data: object) -> None:
        self.events.append((event, data))
        self._changed.set()

    def finish(self) -> None:
        self.done = True
        self._changed.set()

    async def follow(self) -> AsyncIterator[Event]:
        """지금까지의 이벤트부터 끝(done/error)까지. 구독자가 끊겨도 생성은 계속된다."""
        i = 0
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.done:
                return
            # 단일 스레드라 clear 와 wait 사이에 push 가 끼지 못한다(await 지점이 없다)
            self._changed.clear()
            await self._changed.wait()


running: dict[uuid.UUID, Job] = {}  # session_id → 진행 중인 답변(한 세션에 하나)
PER_USER = 3  # 한 사람이 동시에 만들 수 있는 답변 — 끊고 새 세션으로 또 띄우는 식으로 비용을 쌓지 못하게(보안 리뷰)
JOB_TIMEOUT_S = (
    600  # 답 하나의 전체 상한 — 공급자가 멈춰도 그 세션이 AI_BUSY 에 오래 잠기지 않게(보안 리뷰)
)


def busy(session_id: uuid.UUID | None) -> bool:
    return session_id is not None and session_id in running


def start(job: Job, run: Callable[[Job], Awaitable[None]]) -> Job:
    """`run(job)` 을 태스크로. 끝나면(정상·에러·취소 모두) 구독자를 풀어 주고 목록에서 뺀다."""
    if job.session_id in running:
        raise ApiError(409, "AI_BUSY", "이 대화는 아직 답변을 만드는 중입니다.")
    if sum(j.user_id == job.user_id for j in running.values()) >= PER_USER:
        raise ApiError(429, "AI_THROTTLED", f"동시에 만들 수 있는 답변은 {PER_USER}개까지입니다.")
    running[job.session_id] = job

    async def wrapped() -> None:
        try:
            async with asyncio.timeout(JOB_TIMEOUT_S):
                await run(job)
        except TimeoutError:
            job.push(
                "error",
                {"detail": "AI 답변이 제한 시간 안에 끝나지 않았습니다.", "code": "AI_TIMEOUT"},
            )
        finally:
            job.finish()
            running.pop(job.session_id, None)

    job.task = asyncio.create_task(wrapped())  # 참조를 붙들어 GC 로 사라지지 않게
    return job
