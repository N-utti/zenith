"""04-API §4.1 /ws — FR-CHT-01·02·03 · TC-CHT-01·02 · TC-SEC-03(쿠키 없이 거부). 두 사용자가 각자 소켓을 연다."""

import asyncio
import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import HTTPXWSException, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import select, update

from app.models import (
    AuditEvent,
    Channel,
    ChannelMember,
    Folder,
    Message,
    Notification,
    Workspace,
)
from app.realtime.chat import SOCKETS

from .conftest import Users, csrf, login, share_session

WS = "https://test/api/ws"


@pytest.fixture(autouse=True)
def _chat_uses_test_session(app, app_db, monkeypatch):
    from app.realtime import chat as mod

    share_session(app, app_db, monkeypatch, mod)
    yield
    SOCKETS.clear()


def ws_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="https://test")


async def make_channel(app_db, members, *, name="일반", is_dm=False) -> Channel:
    ws = (await app_db.execute(select(Workspace))).scalar_one_or_none()
    if ws is None:
        ws = Workspace(name="제니스")
        app_db.add(ws)
        await app_db.flush()
    channel = Channel(ws_id=ws.id, name=name, is_dm=is_dm)
    app_db.add(channel)
    await app_db.flush()
    app_db.add_all([ChannelMember(channel_id=channel.id, user_id=u.id) for u in members])
    await app_db.flush()
    return channel


async def recv(ws, timeout: float = 2.0) -> dict:
    return json.loads(await asyncio.wait_for(ws.receive_text(), timeout))


async def recv_until(ws, ev: str, timeout: float = 2.0) -> dict:
    """원하는 ev 가 올 때까지 읽는다 — presence 같은 곁다리 이벤트는 건너뛴다."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while (remaining := deadline - loop.time()) > 0:
        event = await recv(ws, remaining)
        if event["ev"] == ev:
            return event
    raise AssertionError(f"{ev} 이벤트가 오지 않았다")


async def silent(ws, seconds: float = 0.3) -> None:
    with pytest.raises(TimeoutError):
        await recv(ws, seconds)


async def send(ws, **op) -> None:
    await ws.send_text(json.dumps(op))


async def test_rejects_without_cookie_and_cross_site(app: FastAPI, users: Users) -> None:
    """TC-SEC-03: 쿠키 없이는 핸드셰이크에서 거부. 우리 것이 아닌 Origin 도(Cross-Site WebSocket Hijacking)."""
    async with ws_client(app) as anon, ws_client(app) as client:
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(WS + "?token=x", anon):
                pass
        await login(client, "sujin@zenith.co.kr")
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(WS, client, headers={"Origin": "https://evil.example"}):
                pass
        assert SOCKETS == {}


async def test_message_unread_read_roundtrip(app: FastAPI, users: Users, app_db) -> None:
    """TC-CHT-01·02: 한쪽이 보내면 다른 쪽이 msg·unread 를 받고, read 로 소거된다. 홈 집계(DB)와 같은 수."""
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            assert (await recv(a_ws))["ev"] == "presence"  # b 가 들어왔다
            await send(a_ws, op="sub", channels=["ch:일반", "user:me"])  # 받아들이되 아무 답 없음
            await send(a_ws, op="msg", channel_id=str(channel.id), body="  안녕하세요 @박동현  ")

            got = await recv_until(b_ws, "msg")
            message = got["message"]
            assert got["channel_id"] == str(channel.id)
            assert message["author"] == {"id": str(users.member.id), "name": "김수진"}
            assert message["body"] == "안녕하세요 @박동현" and message["doc_ref"] is None
            assert (await recv_until(b_ws, "unread")) == {
                "ev": "unread",
                "channel_id": str(channel.id),
                "count": 1,
            }
            notice = await recv_until(b_ws, "notice")  # FR-CHT-02
            assert notice["kind"] == "mention"
            assert notice["payload"]["message_id"] == message["id"]
            assert notice["payload"]["from"]["name"] == "김수진"
            assert notice["payload"]["channel_name"] == "일반"  # 알림함이 "어느 채널" 을 적는다

            own = await recv_until(a_ws, "msg")  # 보낸 사람도 같은 경로로 받는다
            assert own["message"]["id"] == message["id"]
            assert (await recv_until(a_ws, "unread"))["count"] == 0

            # 홈(§2)은 같은 기준으로 센다 — 배지 3곳 일치
            home = (await b.get("/api/me/home")).json()
            assert [u["count"] for u in home["unread"] if u["channel_id"] == str(channel.id)] == [1]

            await send(b_ws, op="read", channel_id=str(channel.id))
            assert (await recv_until(b_ws, "unread"))["count"] == 0
            home = (await b.get("/api/me/home")).json()
            assert home["unread"] == []

    rows = (await app_db.execute(select(Message))).scalars().all()
    assert len(rows) == 1 and rows[0].author_id == users.member.id
    n = (await app_db.execute(select(Notification))).scalar_one()
    assert n.user_id == users.lead.id and n.kind == "mention"


async def test_non_member_is_refused_and_audited(app: FastAPI, users: Users, app_db) -> None:
    """멤버가 아닌 채널(또는 없는 채널)에 쓰면 error FORBIDDEN + acl.denied. 메시지는 남지 않는다."""
    channel = await make_channel(app_db, [users.lead, users.exec])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            for channel_id in (channel.id, uuid.uuid4()):
                await send(a_ws, op="msg", channel_id=str(channel_id), body="끼어들기")
                err = await recv_until(a_ws, "error")
                assert err["code"] == "FORBIDDEN" and err["channel_id"] == str(channel_id)
            for _ in range(2):  # 같은 (채널, op) 는 감사에 한 번만 — 프레임마다 행이 쌓이지 않는다
                await send(a_ws, op="typing", channel_id=str(channel.id))
                assert (await recv_until(a_ws, "error"))["code"] == "FORBIDDEN"
    assert (await app_db.execute(select(Message))).scalars().all() == []
    denied = (
        (
            await app_db.execute(
                select(AuditEvent).where(AuditEvent.kind == "acl.denied").order_by(AuditEvent.at)
            )
        )
        .scalars()
        .all()
    )
    assert len(denied) == 3 and {d.detail["op"] for d in denied} == {"msg", "typing"}
    assert denied[0].actor_id == users.member.id and denied[0].target_id == channel.id


async def test_typing_and_presence(app: FastAPI, users: Users, app_db) -> None:
    """typing 은 같은 채널의 다른 사람에게만. presence 는 첫 탭이 열릴 때·마지막 탭이 닫힐 때."""
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            async with aconnect_ws(WS, b) as b_ws:
                assert (await recv(a_ws)) == {
                    "ev": "presence",
                    "user_id": str(users.lead.id),
                    "online": True,
                }
                assert (await recv(b_ws))["user_id"] == str(users.member.id)  # 먼저 와 있던 사람
                async with aconnect_ws(
                    WS, b
                ) as b_tab2:  # 두 번째 탭은 presence 를 다시 내지 않는다
                    assert (await recv(b_tab2))["user_id"] == str(users.member.id)
                    await silent(a_ws)
                    await send(a_ws, op="typing", channel_id=str(channel.id))
                    for ws in (b_ws, b_tab2):  # 모든 탭이 받는다
                        assert (await recv(ws)) == {
                            "ev": "typing",
                            "channel_id": str(channel.id),
                            "user_id": str(users.member.id),
                            "name": "김수진",
                        }
                    await silent(a_ws)  # 자기에게는 안 온다
                await silent(a_ws)  # 탭 하나가 닫혀도 아직 online
            assert (await recv(a_ws)) == {
                "ev": "presence",
                "user_id": str(users.lead.id),
                "online": False,
            }


async def test_bad_frames_and_doc_card(app: FastAPI, users: Users, app_db) -> None:
    """깨진 JSON·모르는 op·빈 본문은 error 로 답하고 소켓은 산다. 문서 카드는 살아 있는 문서만."""
    channel = await make_channel(app_db, [users.member])
    ws_row = (await app_db.execute(select(Workspace))).scalar_one()
    folder = Folder(ws_id=ws_row.id, parent_id=None, title="회사 위키")
    app_db.add(folder)
    await app_db.flush()
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        r = await a.post(
            "/api/docs", json={"folder_id": str(folder.id), "title": "로드맵"}, headers=csrf(a)
        )
        doc_id = r.json()["id"]
        async with aconnect_ws(WS, a) as a_ws:
            await a_ws.send_text("{not json")
            assert (await recv(a_ws))["code"] == "VALIDATION"
            await send(a_ws, op="fly", channel_id=str(channel.id))
            assert (await recv(a_ws))["code"] == "VALIDATION"
            await send(a_ws, op="msg", channel_id=str(channel.id), body="   ")
            assert (await recv(a_ws))["code"] == "VALIDATION"
            await send(
                a_ws, op="msg", channel_id=str(channel.id), body="x", doc_ref=str(uuid.uuid4())
            )
            assert (await recv(a_ws))["code"] == "VALIDATION"
            await send(
                a_ws, op="msg", channel_id=str(channel.id), body="문서 봐 주세요", doc_ref=doc_id
            )
            got = await recv_until(a_ws, "msg")
            assert got["message"]["doc_ref"] == doc_id
            assert (await recv_until(a_ws, "unread"))["count"] == 0


async def test_outsider_gets_nothing_and_mention_needs_membership(
    app: FastAPI, users: Users, app_db
) -> None:
    """채널 밖 사람은 msg 도 typing 도 받지 않고, 채널 밖 사람을 멘션해도 알림이 생기지 않는다."""
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as c:
        await login(a, "sujin@zenith.co.kr")
        await login(c, "jaeho@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, c) as c_ws:
            await recv(a_ws)  # presence(c)
            await recv(c_ws)  # presence(a) — 이미 와 있던 사람
            await send(a_ws, op="typing", channel_id=str(channel.id))
            await send(a_ws, op="msg", channel_id=str(channel.id), body="@최재호 @박동현 보세요")
            await recv_until(a_ws, "msg")
            await silent(c_ws)
    n = (await app_db.execute(select(Notification))).scalar_one()
    assert n.user_id == users.lead.id  # 최재호(채널 밖)에게는 없다


async def test_revoked_session_closes_silent_socket(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """세션이 회수되면(로그아웃·강제 종료) 아무것도 안 보내는 소켓도 다음 재검증에서 닫힌다."""
    from datetime import timedelta

    from app.models import AuthSession
    from app.realtime import chat as mod

    monkeypatch.setattr(mod, "REAUTH_INTERVAL", timedelta(seconds=0.5))
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await silent(a_ws, 0.8)  # 유효한 세션은 재검증을 지나도 살아 있다
            await app_db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users.member.id)
                .values(revoked_at=datetime.now(UTC))
            )
            await app_db.flush()
            with pytest.raises(Exception, match="4401|closed|Disconnect") as excinfo:
                await recv(a_ws, 3.0)
            assert not isinstance(excinfo.value, TimeoutError)
    assert SOCKETS == {}


async def test_oversized_frame_closes_socket(app: FastAPI, users: Users, app_db) -> None:
    """64KB(바이트) 넘는 프레임은 1009 로 닫는다 — README 11(d)."""
    channel = await make_channel(app_db, [users.member])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="가" * 30_000)  # 90KB
            with pytest.raises(Exception) as excinfo:
                await recv(a_ws, 3.0)
            assert not isinstance(excinfo.value, TimeoutError)
    assert (await app_db.execute(select(Message))).scalars().all() == []
    async with ws_client(app) as a:  # 바이너리 프레임도 자기 소켓만 닫힌다
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await a_ws.send_bytes(b"\x00\x01")
            with pytest.raises(Exception) as excinfo:
                await recv(a_ws, 3.0)
            assert not isinstance(excinfo.value, TimeoutError)
    assert SOCKETS == {}


async def test_doc_comment_mention_is_pushed(app: FastAPI, users: Users, app_db) -> None:
    """TC-DOC-06 후반: 문서 댓글의 @멘션 알림이 열린 소켓으로 밀린다(04 §3 '푸시는 /ws 몫')."""
    ws_row = Workspace(name="제니스")
    app_db.add(ws_row)
    await app_db.flush()
    folder = Folder(ws_id=ws_row.id, parent_id=None, title="회사 위키")
    app_db.add(folder)
    await app_db.flush()
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        r = await a.post(
            "/api/docs", json={"folder_id": str(folder.id), "title": "로드맵"}, headers=csrf(a)
        )
        doc_id = r.json()["id"]
        async with aconnect_ws(WS, b) as b_ws:
            r = await a.post(
                f"/api/docs/{doc_id}/comments", json={"body": "@박동현 확인 부탁"}, headers=csrf(a)
            )
            assert r.status_code == 201, r.text
            notice = await recv_until(b_ws, "notice")
            assert notice["kind"] == "mention"
            assert (
                notice["payload"]["doc_id"] == doc_id
                and notice["payload"]["comment_id"] == r.json()["id"]
            )
            assert notice["id"] and notice["created_at"]


async def test_mention_off_gets_message_but_no_notice(app: FastAPI, users: Users, app_db) -> None:
    """이슈 #81: 멘션 알림을 끈 사람도 메시지·unread 는 받고 notice 만 안 받는다(알림 행도 없다)."""
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        r = await b.patch(
            "/api/me/preferences", json={"notifications": {"mention": False}}, headers=csrf(b)
        )
        assert r.status_code == 200, r.text

        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            assert (await recv(a_ws))["ev"] == "presence"
            await send(a_ws, op="msg", channel_id=str(channel.id), body="@박동현 확인 부탁해요")
            assert (await recv_until(b_ws, "msg"))["channel_id"] == str(channel.id)
            assert (await recv_until(b_ws, "unread"))["count"] == 1
            await silent(b_ws)  # notice 는 오지 않는다

    assert (await app_db.execute(select(Notification))).scalars().all() == []


async def test_dm_mention_notice_has_no_channel_name(app: FastAPI, users: Users, app_db) -> None:
    """DM 은 `channels.name` 이 "" — 받는 사람에게 이 DM 의 이름은 보낸 사람이다(channels._display_name 과 같은 기준)."""
    channel = await make_channel(app_db, [users.member, users.lead], name="", is_dm=True)
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            assert (await recv(a_ws))["ev"] == "presence"
            await send(a_ws, op="msg", channel_id=str(channel.id), body="@박동현 잠깐 볼까요")
            notice = await recv_until(b_ws, "notice")
            assert notice["payload"]["channel_name"] == "김수진"  # 받는 사람이 보는 이 DM 의 이름
            assert notice["payload"]["from"]["name"] == "김수진"
