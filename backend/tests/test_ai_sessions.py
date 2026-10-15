"""README 58 — 답변 생성이 SSE 연결과 분리된다: 화면을 떠나도 서버가 끝까지 만들어 저장하고, 돌아오면 이어 받는다.

ASGITransport 는 응답을 다 모아서 돌려주므로(중간에 끊을 수 없다) 같은 이벤트 루프 안에 uvicorn 을 띄워 진짜 소켓으로
끊는다. DB 는 다른 테스트와 같이 `app_db`(한 세션) — 서버 쪽 처리와 테스트의 HTTP 호출이 겹치지 않게 태스크를 기다린다.
"""

from __future__ import annotations

import asyncio
import json
import socket
import uuid
from collections.abc import AsyncIterator

import pytest
import uvicorn
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.ai import jobs
from app.ai.provider import get_provider
from app.config import settings
from app.models import AiMessage
from tests.conftest import Users, csrf, login
from tests.test_ai import FakeProvider, share_scope


class GatedProvider(FakeProvider):
    """첫 토큰을 내고 문이 열릴 때까지 기다린다 — 그 사이에 클라이언트가 떠나고 돌아온다."""

    gate: asyncio.Event

    async def stream(
        self,
        *,
        system: str,
        messages: list[dict],
        max_tokens: int | None = None,
        tools=None,
        tool_choice=None,
    ) -> AsyncIterator:
        yield "먼저"
        await GatedProvider.gate.wait()
        yield " 나중"


@pytest.fixture
async def live(app: FastAPI, monkeypatch) -> AsyncIterator[AsyncClient]:
    monkeypatch.setattr(settings, "cookie_secure", False)  # http 로 붙는다
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))  # 잡은 소켓을 그대로 넘긴다(포트 경합 없음)
    sock.listen()
    port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            app, lifespan="off", log_level="warning", log_config=None
        )  # log_config=None — 전역 로깅을 건드리지 않게
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():
            task.result()  # 기동 실패를 무한 대기 대신 예외로
        await asyncio.sleep(0.01)
    try:
        async with AsyncClient(base_url=f"http://127.0.0.1:{port}") as c:
            yield c
    finally:
        server.should_exit = True
        await task
        sock.close()


@pytest.fixture
async def gated(app: FastAPI, monkeypatch, app_db):
    GatedProvider.gate = asyncio.Event()
    app.dependency_overrides[get_provider] = GatedProvider
    share_scope(monkeypatch, app_db)
    yield
    # 테스트마다 끝까지 기다린다(세션이 롤백된 뒤 태스크가 DB 를 만지면 안 된다). 테스트가 중간에 죽었으면 여기서
    # 문을 열어 남은 태스크를 끝내 다음 테스트를 오염시키지 않는다 — 그러고도 남아 있던 것은 실패로 알린다.
    leftover = list(jobs.running.values())
    GatedProvider.gate.set()
    for job in leftover:
        if job.task is not None:
            await job.task
    jobs.running.clear()
    assert not leftover


async def _first_frame(c: AsyncClient, method: str, url: str, **kw) -> str:
    """스트림을 열어 첫 프레임만 읽고 끊는다(화면을 떠남)."""
    async with c.stream(method, url, **kw) as r:
        assert r.status_code == 200, await r.aread()
        async for chunk in r.aiter_text():
            return chunk
    raise AssertionError("프레임이 없다")


def _events(text: str) -> list[tuple[str, object]]:
    out = []
    for block in text.strip().split("\n\n"):
        ev, data = block.split("\n", 1)
        out.append((ev.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return out


async def _finish(sid: str) -> None:
    GatedProvider.gate.set()
    job = jobs.running.get(uuid.UUID(sid))
    if job is not None and job.task is not None:
        await job.task


async def test_answer_is_finished_and_saved_after_client_leaves(
    live: AsyncClient, users: Users, app_db, gated
) -> None:
    await login(live, "sujin@zenith.co.kr")
    sid = str(uuid.uuid4())
    first = await _first_frame(
        live,
        "POST",
        "/api/ai/chat",
        json={"session_id": sid, "message": "질문"},
        headers=csrf(live),
    )
    assert _events(first) == [("token", {"text": "먼저"})]
    await asyncio.sleep(0.05)  # 서버가 끊김을 알아채도 태스크는 산다
    assert uuid.UUID(sid) in jobs.running
    await _finish(sid)
    rows = (
        await app_db.execute(
            select(AiMessage.msg_role, AiMessage.body)
            .where(AiMessage.session_id == uuid.UUID(sid))
            .order_by(AiMessage.created_at)
        )
    ).all()
    assert [tuple(r) for r in rows] == [("user", "질문"), ("assistant", "먼저 나중")]


async def test_returning_client_sees_pending_and_reattaches(
    live: AsyncClient, users: Users, app_db, gated
) -> None:
    await login(live, "sujin@zenith.co.kr")
    sid = str(uuid.uuid4())
    await _first_frame(
        live,
        "POST",
        "/api/ai/chat",
        json={"session_id": sid, "message": "질문"},
        headers=csrf(live),
    )
    # 돌아온 화면: 목록·상세에 진행 중으로 보인다 — 메시지는 아직 없다(답과 함께 저장된다)
    r = await live.get("/api/ai/sessions")
    assert [(s["id"], s["title"], s["pending"]) for s in r.json()] == [(sid, "질문", True)]
    r = await live.get(f"/api/ai/sessions/{sid}")
    assert r.json()["messages"] == [] and r.json()["pending"]["message"] == "질문"
    # 이어 받기: 지금까지의 토큰부터 done 까지
    async with live.stream("GET", f"/api/ai/sessions/{sid}/stream") as r:
        assert r.status_code == 200
        it = r.aiter_text()
        assert _events(await it.__anext__()) == [("token", {"text": "먼저"})]
        GatedProvider.gate.set()
        rest = ""
        async for chunk in it:
            rest += chunk
    ev = _events(rest)
    assert ev[0] == ("token", {"text": " 나중"}) and ev[1] == ("citations", [])
    assert ev[2][0] == "done" and ev[2][1]["session_id"] == sid
    await _finish(sid)
    # 끝난 뒤: 저장된 대화가 보이고, 진행 중은 아니다
    r = await live.get(f"/api/ai/sessions/{sid}")
    assert [(m["role"], m["body"]) for m in r.json()["messages"]] == [
        ("user", "질문"),
        ("assistant", "먼저 나중"),
    ]
    assert r.json()["pending"] is None
    assert (await live.get(f"/api/ai/sessions/{sid}/stream")).status_code == 404
    assert [(s["pending"], s["title"]) for s in (await live.get("/api/ai/sessions")).json()] == [
        (False, "질문")
    ]


async def test_second_question_while_answering_is_409(
    live: AsyncClient, users: Users, app_db, gated
) -> None:
    await login(live, "sujin@zenith.co.kr")
    sid = str(uuid.uuid4())
    await _first_frame(
        live,
        "POST",
        "/api/ai/chat",
        json={"session_id": sid, "message": "질문"},
        headers=csrf(live),
    )
    r = await live.post(
        "/api/ai/chat", json={"session_id": sid, "message": "또 질문"}, headers=csrf(live)
    )
    assert r.status_code == 409 and r.json()["code"] == "AI_BUSY"
    await _finish(sid)


async def test_sessions_are_private(
    live: AsyncClient, users: Users, app_db, gated, make_client
) -> None:
    await login(live, "sujin@zenith.co.kr")
    sid = str(uuid.uuid4())
    await _first_frame(
        live,
        "POST",
        "/api/ai/chat",
        json={"session_id": sid, "message": "질문"},
        headers=csrf(live),
    )
    other = make_client()
    await login(other, "donghyun@zenith.co.kr")
    assert (await other.get("/api/ai/sessions")).json() == []
    assert (await other.get(f"/api/ai/sessions/{sid}")).status_code == 404
    assert (await other.get(f"/api/ai/sessions/{sid}/stream")).status_code == 404
    await other.aclose()
    await _finish(sid)
