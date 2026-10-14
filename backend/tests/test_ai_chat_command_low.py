"""채팅 `/ai` 리뷰 후속 — 타임아웃·unread 값·exec 봇 글 삭제·제목 정리·멤버십 재확인."""

import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import delete, select

from app.ai import chat_command
from app.models import ChannelMember, Message
from app.realtime.chat import SOCKETS
from app.routers import ai as ai_router

from .conftest import Users, login, share_session
from .test_ai import _knowledge
from .test_ai_chat_command import Bot
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
    monkeypatch.setattr(ai_router, "session_scope", scope)
    ai_router._ai_calls.clear()
    yield
    SOCKETS.clear()
    ai_router._ai_calls.clear()


def ws_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="https://test")


def test_plain_title_folds_markdown() -> None:
    assert (
        chat_command._plain_title("![x](http://e.vil)\n<b>제목</b> `코드`")
        == "！［x］（http://e.vil） 〈b〉제목〈/b〉 '코드'"
    )
    assert len(chat_command._plain_title("가" * 200)) == 80


async def test_unread_counts_and_exec_can_delete_bot_message(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    monkeypatch.setattr(chat_command, "get_provider", lambda: Bot())
    await _knowledge(app_db, users)
    channel = await make_channel(app_db, [users.member, users.lead, users.exec])
    async with ws_client(app) as a, ws_client(app) as b, ws_client(app) as c:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        await login(c, "jaeho@zenith.co.kr")
        async with (
            aconnect_ws(WS, a) as a_ws,
            aconnect_ws(WS, b) as b_ws,
            aconnect_ws(WS, c) as c_ws,
        ):
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 연차?")
            await recv_until(b_ws, "msg")
            assert (await recv_until(b_ws, "unread"))["count"] == 1
            bot = await recv_until(b_ws, "msg", timeout=5.0)
            assert bot["message"]["author"]["is_bot"] is True
            assert (await recv_until(b_ws, "unread"))["count"] == 2  # 내 글 + 봇 글
            await recv_until(a_ws, "msg")
            await recv_until(a_ws, "unread")
            await recv_until(a_ws, "msg", timeout=5.0)
            assert (await recv_until(a_ws, "unread"))["count"] == 1  # 질문자도 봇 글은 안 읽음
            # 일반 멤버는 봇 글을 못 지우고, 임원은 지운다
            await send(b_ws, op="del", channel_id=str(channel.id), message_id=bot["message"]["id"])
            assert (await recv_until(b_ws, "error"))["code"] == "FORBIDDEN"
            await send(c_ws, op="del", channel_id=str(channel.id), message_id=bot["message"]["id"])
            gone = await recv_until(c_ws, "msg_del", timeout=3.0)
            assert gone["message_id"] == bot["message"]["id"]
    assert await app_db.scalar(select(Message).where(Message.id == bot["message"]["id"])) is None


async def test_timeout_posts_failure_and_left_member_gets_nothing(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    class Slow(Bot):
        async def stream(self, **kw):
            await asyncio.sleep(0.3)
            async for x in super().stream(**kw):
                yield x

    monkeypatch.setattr(chat_command, "get_provider", lambda: Slow())
    monkeypatch.setattr(chat_command, "REPLY_TIMEOUT_S", 0.05)
    await _knowledge(app_db, users)
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 느려")
            await recv_until(a_ws, "msg")
            fail = await recv_until(a_ws, "msg", timeout=5.0)
            assert fail["message"]["body"].startswith("AI 답변을 만들지 못했습니다")
    # 답을 기다리는 사이 나간 멤버 — 답을 달지 않는다
    monkeypatch.setattr(chat_command, "REPLY_TIMEOUT_S", 120.0)

    class Leaving(Bot):
        async def stream(self, **kw):
            await app_db.execute(
                delete(ChannelMember).where(
                    ChannelMember.channel_id == channel.id, ChannelMember.user_id == users.member.id
                )
            )
            await app_db.commit()
            async for x in super().stream(**kw):
                yield x

    monkeypatch.setattr(chat_command, "get_provider", lambda: Leaving())
    before = await app_db.scalar(
        select(Message).where(Message.channel_id == channel.id).order_by(Message.created_at.desc())
    )
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 나간다")
            await recv_until(a_ws, "msg")
            with pytest.raises((AssertionError, TimeoutError)):
                await recv_until(a_ws, "msg", timeout=1.0)
    rows = (
        (await app_db.execute(select(Message).where(Message.channel_id == channel.id)))
        .scalars()
        .all()
    )
    bot_id = (await chat_command.ai_user(app_db)).id
    bot_rows = [m for m in rows if m.author_id == bot_id and m.id != before.id]
    assert all("못했습니다" in m.body for m in bot_rows)  # 나간 뒤 새 봇 답은 없다
