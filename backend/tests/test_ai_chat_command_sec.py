"""채팅 `/ai` 보안 가드 (README 52) — 스로틀·봇 계정 보호·is_bot·people 제외."""

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import select

from app.ai import chat_command
from app.models import AuditEvent, User
from app.realtime.chat import SOCKETS
from app.routers import ai as ai_router

from .conftest import Users, csrf, login, share_session
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


async def test_command_shares_ai_throttle_and_sends_error_frame(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    monkeypatch.setattr(chat_command, "get_provider", lambda: Bot())
    monkeypatch.setattr(ai_router, "AI_RATE", 1)
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 하나")
            await recv_until(a_ws, "msg")
            assert (await recv_until(a_ws, "msg", timeout=5.0))["message"]["author"][
                "is_bot"
            ] is True
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 둘")
            err = await recv_until(a_ws, "error", timeout=2.0)  # 오류 프레임이 내 글 방송보다 먼저 온다
            await recv_until(a_ws, "msg")  # 내 글은 올라간다
            assert err["code"] == "AI_THROTTLED" and err["channel_id"] == str(channel.id)
            with pytest.raises((AssertionError, TimeoutError)):
                await recv_until(a_ws, "msg", timeout=0.5)  # 봇 답 없음


async def test_admin_cannot_create_or_edit_bot_and_people_hides_it(
    app: FastAPI, client: AsyncClient, users: Users, app_db
) -> None:
    bot = await chat_command.ai_user(app_db)
    await app_db.commit()
    await login(client, "jaeho@zenith.co.kr")  # exec
    r = await client.post(
        "/api/admin/users",
        json={
            "name": "가짜",
            "email": chat_command.AI_EMAIL,
            "password": "zenith1234",
            "role": "member",
        },
        headers=csrf(client),
    )
    assert r.status_code == 409 and r.json()["detail"] == "예약된 이메일입니다."
    for body in ({"active": True}, {"password": "newpass123"}, {"name": "사람"}):
        r = await client.patch(f"/api/admin/users/{bot.id}", json=body, headers=csrf(client))
        assert r.status_code == 403, body
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "admin.bot_denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 3 and all(d.target_id == bot.id for d in denied)
    fresh = await app_db.get(User, bot.id)
    assert fresh.active is False and fresh.name == "AI 어시스턴트"
    people = (await client.get("/api/people")).json()
    items = people if isinstance(people, list) else people["items"]
    assert all(p["id"] != str(bot.id) for p in items)


async def test_active_bot_account_is_refused(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    bot = await chat_command.ai_user(app_db)
    bot.active = True  # seed·DB 직접 조작으로 켜진 상황
    await app_db.commit()
    monkeypatch.setattr(chat_command, "get_provider", lambda: Bot())
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 질문")
            await recv_until(a_ws, "msg")
            with pytest.raises((AssertionError, TimeoutError)):
                await recv_until(
                    a_ws, "msg", timeout=1.0
                )  # 사칭 가능한 계정으로는 답하지 않는다(실패 메시지도 그 계정이라 생략)
