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
    # 이슈 #403: 새로고침 뒤 과거 메시지 조회·채널 목록의 last_message 에도 봇 표시가 실린다
    async with ws_client(app) as c:
        await login(c, "sujin@zenith.co.kr")
        page = (await c.get(f"/api/channels/{channel.id}/messages")).json()
        assert [i["author"]["is_bot"] for i in page["items"]] == [False, True]
        listed = next(
            x for x in (await c.get("/api/channels")).json()["items"] if x["id"] == str(channel.id)
        )
        assert listed["last_message"]["author"]["is_bot"] is True
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


@pytest.mark.usefixtures("minio_bucket")
async def test_command_creates_spreadsheet_as_channel_attachment(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """README 55: 채팅 /ai 에서 만든 엑셀은 봇 답 메시지의 첨부로 실리고 채널 멤버가 내려받는다(비멤버는 403)."""
    import io

    import openpyxl

    from app.models import ChannelUpload

    class MakingProvider(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            SearchingProvider.tools_seen.append(tools)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(
                    ToolCall(
                        id="mk",
                        name="create_spreadsheet",
                        input={
                            "name": "월별 이익",
                            "sheets": [{"rows": [["월", "이익"], ["1월", 40]]}],
                        },
                    )
                )
                return
            yield "월별 이익 표를 「월별 이익.xlsx」로 첨부했습니다."

    monkeypatch.setattr(chat_command, "get_provider", lambda: MakingProvider())
    SearchingProvider.turns, SearchingProvider.tools_seen = [], []
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            await send(
                a_ws, op="msg", channel_id=str(channel.id), body="/ai 월별 이익을 엑셀로 만들어줘"
            )
            await recv_until(b_ws, "msg")  # 내 글
            bot = await recv_until(b_ws, "msg", timeout=8.0)
            await recv_until(a_ws, "msg")
            await recv_until(a_ws, "msg", timeout=8.0)
    assert bot["message"]["author"]["is_bot"] is True
    atts = bot["message"]["attachments"]
    assert len(atts) == 1 and atts[0]["name"] == "월별 이익.xlsx" and atts[0]["size"] > 0
    assert atts[0]["content_type"].endswith("spreadsheetml.sheet")
    assert atts[0]["url"].startswith(f"/api/channels/{channel.id}/attachments/")
    assert "create_spreadsheet" in [t["name"] for t in SearchingProvider.tools_seen[0]]
    result = SearchingProvider.turns[-1][-1]["content"][0]
    assert "is_error" not in result and "첨부로 실립니다" in result["content"]
    # 저장된 메시지에도 실렸고, 업로드 기록부의 올린 사람은 봇
    row = await app_db.scalar(
        select(Message).where(Message.channel_id == channel.id).order_by(Message.created_at.desc())
    )
    assert row.attachments == atts
    bot_user = await app_db.scalar(select(User).where(User.email == chat_command.AI_EMAIL))
    up = await app_db.scalar(select(ChannelUpload).where(ChannelUpload.channel_id == channel.id))
    assert up is not None and up.uploader_id == bot_user.id and up.size == atts[0]["size"]
    ev = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.file_create"))
    assert (
        ev is not None
        and ev.actor_id == users.member.id
        and ev.detail["channel"] == str(channel.id)
    )
    # 멤버(팀장)는 내려받고, 비멤버(임원)는 403
    async with ws_client(app) as c:
        await login(c, "donghyun@zenith.co.kr")
        r = await c.get(atts[0]["url"])
        assert r.status_code == 200, r.text
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        assert wb.active["B2"].value == 40 and wb.active["A1"].font.bold
    async with ws_client(app) as d:
        await login(d, "jaeho@zenith.co.kr")
        assert (await d.get(atts[0]["url"])).status_code == 403  # 멤버 아님 — acl.denied


@pytest.mark.usefixtures("minio_bucket")
async def test_command_file_failures_keep_answer_and_clean_objects(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """모양 틀린 표는 is_error 뒤에도 답이 나가고 첨부는 null. 파일을 만든 뒤 공급자가 죽으면 오브젝트를 지운다."""
    from app import storage

    class BadThenGood(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(
                    ToolCall(id="bad", name="create_spreadsheet", input={"name": "x", "sheets": []})
                )
                return
            yield "표 모양을 못 정했습니다."

    class MadeThenCrash(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(
                    ToolCall(
                        id="ok",
                        name="create_spreadsheet",
                        input={"name": "y", "sheets": [{"rows": [[1]]}]},
                    )
                )
                return
            raise RuntimeError("provider down")

    channel = await make_channel(app_db, [users.member, users.lead])
    for provider, expected in (
        (BadThenGood, "표 모양을 못 정했습니다."),
        (MadeThenCrash, "AI 답변을 만들지 못했습니다"),
    ):
        monkeypatch.setattr(chat_command, "get_provider", lambda p=provider: p())
        SearchingProvider.turns = []
        async with ws_client(app) as a:
            await login(a, "sujin@zenith.co.kr")
            async with aconnect_ws(WS, a) as a_ws:
                await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 엑셀로")
                await recv_until(a_ws, "msg")
                bot = await recv_until(a_ws, "msg", timeout=8.0)
        assert bot["message"]["body"].startswith(expected) and bot["message"]["attachments"] is None
    result = SearchingProvider.turns[-1][-1]["content"][0]
    assert "is_error" not in result  # 파일은 만들어졌지만
    url = result["content"]
    rows = (
        (await app_db.execute(select(Message).where(Message.channel_id == channel.id)))
        .scalars()
        .all()
    )
    assert all(m.attachments is None for m in rows)
    uploads = (await app_db.execute(select(chat_command.ChannelUpload))).scalars().all()
    assert uploads == []  # 행은 롤백
    # 오브젝트도 지워졌다 — 채널 접두 아래에 남은 게 없다
    assert (
        await storage.get(f"channels/{channel.id}/") is None or True
    )  # get 은 키 단위 — 아래 list 로 확인
    client = storage._client()
    left = list(
        client.list_objects(
            storage.settings.minio_bucket, prefix=f"channels/{channel.id}/", recursive=True
        )
    )
    assert left == [], [o.object_name for o in left]
    assert url  # 도구 결과 문구는 남는다


async def test_chat_command_gets_only_channel_safe_tools(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """채팅 /ai 의 답은 채널 전원이 본다 — 자료실·파일 읽기만 주고 근태·결재는 주지 않는다(README 56)."""
    from httpx_ws import aconnect_ws

    from app.ai import chat_command

    from .test_ai_chat_command import WS, recv_until, send, ws_client
    from .test_ws import make_channel

    class Peek(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.tools_seen.append(tools)
            yield "자료실을 볼 수 있습니다."

    monkeypatch.setattr(chat_command, "get_provider", lambda: Peek())
    SearchingProvider.tools_seen = []
    channel = await make_channel(app_db, [users.member, users.lead])
    async with ws_client(app) as a:
        await login(a, "sujin@zenith.co.kr")
        async with aconnect_ws(WS, a) as a_ws:
            await send(a_ws, op="msg", channel_id=str(channel.id), body="/ai 뭐 있어")
            await recv_until(a_ws, "msg")
            await recv_until(a_ws, "msg", timeout=8.0)
    names = [t["name"] for t in SearchingProvider.tools_seen[0]]
    assert "archive" in names and "read_file" in names
    assert "attendance" not in names and "approvals" not in names and "approval_detail" not in names
