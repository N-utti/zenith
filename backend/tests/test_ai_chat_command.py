"""채팅창 `/ai` 커맨드 (README 52) — 소켓 왕복으로 봇 답 메시지가 오는지."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import select

from app.ai import chat_command
from app.ai.provider import ToolCall
from app.models import AuditEvent, Message, User
from app.realtime.chat import SOCKETS

from .conftest import Users, csrf, login, share_session
from .test_ai import SearchingProvider, _knowledge
from .test_ws import make_channel, recv_until, send

WS = "https://test/api/ws"


@pytest.fixture(autouse=True)
def _shared(app, app_db, monkeypatch):
    from app.realtime import chat as mod

    share_session(app, app_db, monkeypatch, mod)

    @asynccontextmanager
    async def scope():
        yield app_db

    monkeypatch.setattr(chat_command, "session_scope", scope)
    from app.routers import ai as ai_router

    monkeypatch.setattr(
        ai_router, "session_scope", scope
    )  # 검색 도구도 테스트 DB 로(안 하면 개발 DB 를 읽는다)
    yield
    SOCKETS.clear()


def ws_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="https://test")


class Bot(SearchingProvider):
    """검색 한 번 뒤 각주 단 답 — 커맨드 질문·첨부 블록을 기록한다."""

    answer = "연차는 15일입니다[[1]]."

    async def stream(
        self, *, system, messages, max_tokens=None, tools=None, tool_choice=None
    ) -> AsyncIterator:
        SearchingProvider.systems.append(system)
        SearchingProvider.turns.append(messages)
        last = messages[-1]["content"]
        if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
            yield self.calls(ToolCall(id="x", name="search_knowledge", input={"query": "연차"}))
            return
        yield self.answer


def test_parse() -> None:
    assert chat_command.parse("/ai 연차 며칠?") == "연차 며칠?"
    assert chat_command.parse("  /ai   ") == ""
    assert chat_command.parse("/ai") == ""
    assert chat_command.parse("/aix") is None and chat_command.parse("안녕 /ai") is None
    assert chat_command.parse("/AI 질문") is None  # 소문자만


async def test_command_posts_bot_reply_to_channel(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    monkeypatch.setattr(chat_command, "get_provider", lambda: Bot())
    SearchingProvider.systems, SearchingProvider.turns = [], []
    await _knowledge(app_db, users)
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 연차 며칠이야?")
            mine = await recv_until(b_ws, "msg")
            assert mine["message"]["body"] == "/ai 연차 며칠이야?"  # 내 글은 평소처럼 먼저
            bot = await recv_until(b_ws, "msg", timeout=5.0)
            assert bot["message"]["author"]["name"] == "AI 어시스턴트"
            assert bot["message"]["body"].startswith("연차는 15일입니다[[1]].")
            assert (
                "\n\n근거: [1] " in bot["message"]["body"] and " /docs/" in bot["message"]["body"]
            )
            assert bot["message"]["attachments"] is None
            own = await recv_until(a_ws, "msg")
            assert own["message"]["body"] == "/ai 연차 며칠이야?"
            assert (await recv_until(a_ws, "msg", timeout=5.0))["message"]["author"][
                "name"
            ] == "AI 어시스턴트"
    # 질문만 갔다 — 채널 대화·이전 글 없음, 커맨드 접두는 뗐다
    assert SearchingProvider.turns[0][0] == {"role": "user", "content": "연차 며칠이야?"}
    assert "채팅방의 다른 대화는 모른다" in SearchingProvider.systems[0][-1]["text"]
    bot_user = await app_db.scalar(select(User).where(User.email == chat_command.AI_EMAIL))
    assert bot_user is not None and bot_user.active is False and bot_user.name == "AI 어시스턴트"
    rows = (await app_db.execute(select(Message).order_by(Message.created_at))).scalars().all()
    assert [m.author_id for m in rows] == [users.member.id, bot_user.id]
    ev = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.chat_command"))
    assert (
        ev is not None
        and ev.actor_id == users.member.id
        and ev.detail == {"chars": 8, "attachments": 0}
    )


async def test_plain_message_and_bare_command(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    calls: list[int] = []

    def provider():
        calls.append(1)
        return Bot()

    monkeypatch.setattr(chat_command, "get_provider", provider)
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="오늘 점심 뭐 먹지")
            await recv_until(a_ws, "msg")
            with pytest.raises((AssertionError, TimeoutError)):
                await recv_until(a_ws, "msg", timeout=0.5)  # 봇 답 없음
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai")
            await recv_until(a_ws, "msg")
            bot = await recv_until(a_ws, "msg", timeout=5.0)
            assert "질문을 적어 주세요" in bot["message"]["body"]
    assert calls == []  # 공급자를 부르지 않았다


async def test_bot_login_is_refused(app: FastAPI, client: AsyncClient, app_db) -> None:
    await chat_command.ai_user(app_db)
    await app_db.commit()
    r = await client.post("/api/auth/login", json={"email": chat_command.AI_EMAIL, "password": "!"})
    assert r.status_code in (401, 403)


@pytest.mark.usefixtures("minio_bucket")
async def test_command_reads_channel_attachment(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    monkeypatch.setattr(chat_command, "get_provider", lambda: Bot())
    SearchingProvider.systems, SearchingProvider.turns = [], []
    await _knowledge(app_db, users)
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        up = await a.post(
            f"/api/channels/{channel.id}/attachments",
            files={"file": ("매출.csv", "월,매출\n1월,120\n".encode(), "text/csv")},
            headers=csrf(a),
        )
        assert up.status_code in (200, 201), up.text
        att = up.json()
        async with aconnect_ws(WS, a) as a_ws:
            await send(
                a_ws,
                op="msg",
                channel_id=str(channel.id),
                body="/ai 이 파일 요약",
                attachments=[att],
            )
            await recv_until(a_ws, "msg")
            bot = await recv_until(a_ws, "msg", timeout=5.0)
            assert bot["message"]["author"]["name"] == "AI 어시스턴트"
    system = SearchingProvider.systems[0]
    block = next(b["text"] for b in system if "<첨부>" in b["text"])
    assert (
        "[1] 《매출.csv》 월 | 매출\n1월 | 120" in block
    )  # 첨부가 추출돼 들어갔다(검색 번호는 그 뒤)
    assert SearchingProvider.turns[0][0]["content"] == "이 파일 요약"


async def test_failure_posts_short_message(app: FastAPI, users: Users, app_db, monkeypatch) -> None:
    class Broken:
        def models(self):
            return [{"name": "x"}]

        async def stream(self, **_):
            raise RuntimeError("boom")
            yield  # noqa: RET503 — 제너레이터로 만든다

    monkeypatch.setattr(chat_command, "get_provider", lambda: Broken())
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 뭐든")
            await recv_until(a_ws, "msg")
            bot = await recv_until(a_ws, "msg", timeout=5.0)
            assert bot["message"]["body"].startswith("AI 답변을 만들지 못했습니다")
    await asyncio.sleep(0)
    assert json.dumps  # 사용 표시
