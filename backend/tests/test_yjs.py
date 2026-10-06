"""04-API §4.2 /yjs — FR-DOC-02·03 · TC-DOC-02·04 · TC-SEC-03. 클라이언트는 pycrdt 로 y-websocket 프로토콜을 흉내 낸다."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import HTTPXWSException, WebSocketDisconnect, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from pycrdt import (
    Awareness,
    Doc,
    Map,
    XmlElement,
    XmlFragment,
    XmlText,
    YMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)
from sqlalchemy import select, update

from app.models import Document, Folder, Workspace
from app.realtime.yjs import ROOMS

from .conftest import Users, csrf, login, share_session


@pytest.fixture(autouse=True)
def _yjs_uses_test_session(app, app_db, monkeypatch):
    from app.realtime import yjs as mod

    share_session(app, app_db, monkeypatch, mod)


def ws_client(app: FastAPI) -> AsyncClient:
    """httpx 기본 ASGITransport 는 WebSocket 을 모른다. 픽스처가 아니라 테스트 본문에서 여닫는다 —
    전송의 anyio 태스크 그룹이 픽스처 setup/teardown 처럼 다른 태스크에서 닫히면 터진다."""
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="https://test")


async def _doc_id(client: AsyncClient, app_db) -> str:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    r = await client.post(
        "/api/docs", json={"folder_id": str(root.id), "title": "초안"}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


class Peer:
    """y-websocket 클라이언트 한 명: Y.Doc + awareness + 서버와의 sync 왕복."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.doc = Doc(skip_gc=True)
        self.awareness = Awareness(self.doc)
        self.awareness.set_local_state(None)
        self.doc.observe(self._on_update)
        self._outgoing: list[bytes] = []

    def _on_update(self, event) -> None:
        self._outgoing.append(create_update_message(event.update))

    async def connect(self) -> None:
        await self.ws.send_bytes(create_sync_message(self.doc))
        await self.pump()

    async def edit(self, fn) -> None:
        with self.doc.transaction():
            fn(self.doc)
        for message in self._outgoing:
            await self.ws.send_bytes(message)
        self._outgoing.clear()

    async def pump(self, seconds: float = 0.3) -> None:
        """잠깐 동안 오는 메시지를 전부 처리한다 (step1 → step2 회신, step2/update 적용, awareness 적용)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds
        while (remaining := deadline - loop.time()) > 0:
            try:
                message = await asyncio.wait_for(self.ws.receive_bytes(), timeout=remaining)
            except TimeoutError:
                return
            if message[0] == YMessageType.SYNC:
                reply = handle_sync_message(message[1:], self.doc)
                if reply is not None:
                    await self.ws.send_bytes(reply)
            elif message[0] == YMessageType.AWARENESS:
                self.awareness.apply_awareness_update(read_message(message[1:]), origin="server")

    @property
    def text(self) -> str:
        frag = self.doc.get("default", type=XmlFragment)
        return "".join(str(c) for el in frag.children for c in el.children)

    @property
    def title(self):
        return self.doc.get("meta", type=Map).get("title")


async def rooms_empty(timeout: float = 2.0) -> None:
    """서버 쪽 finally(저장·방 정리)가 끝나길 기다린다 — 시계가 아니라 상태를 본다."""
    from app.realtime import yjs as mod

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while (ROOMS or mod.pending_saves) and loop.time() < deadline:
        await asyncio.sleep(0.02)
    assert ROOMS == {} and mod.pending_saves == 0, (ROOMS, mod.pending_saves)


def write_paragraph(text: str):
    def fn(doc: Doc) -> None:
        frag = doc.get("default", type=XmlFragment)
        para = XmlElement("paragraph")
        frag.children.append(para)
        para.children.append(XmlText(text))

    return fn


async def expect_close(ws, code: int, timeout: float = 3.0) -> None:
    """서버가 accept 뒤 이 코드로 닫았는지 — y-websocket 은 44xx 를 영구 종료로 본다(#340)."""
    with pytest.raises(WebSocketDisconnect) as excinfo:
        await asyncio.wait_for(ws.receive_bytes(), timeout)
    assert excinfo.value.code == code


async def test_rejects_without_cookie(app: FastAPI, users: Users, app_db, monkeypatch) -> None:
    """TC-SEC-03: 쿠키 없이는 바이트 하나도 못 받는다 — accept 뒤 4401(#340). ?token= 도 소용없다.
    방은 열리지 않는다. DB 가 끊겨 있으면 1013."""
    from app.realtime import yjs as mod

    async with ws_client(app) as client, ws_client(app) as anon:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}?token=x", anon) as ws:
            await expect_close(ws, 4401)
        assert doc_id not in {str(k) for k in ROOMS}
        # 인증이 문서 조회보다 먼저 — 비인증은 없는 문서도 4401(존재 여부를 모른다). 깨진 쿠키도 1013 이 아닌 4401
        async with aconnect_ws(f"https://test/api/yjs/{uuid.uuid4()}", anon) as ws:
            await expect_close(ws, 4401)
        async with aconnect_ws(
            f"https://test/api/yjs/{doc_id}", anon, headers={"Cookie": "access=garbage.token.x"}
        ) as ws:
            await expect_close(ws, 4401)

        async def db_down(*a, **kw):
            raise RuntimeError("connection refused")

        monkeypatch.setattr(mod, "authenticate", db_down)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as ws:
            await expect_close(ws, 1013)
        assert ROOMS == {}


async def test_cross_site_origin_is_rejected(app: FastAPI, users: Users, app_db) -> None:
    """Cross-Site WebSocket Hijacking: 브라우저는 소켓에 쿠키를 자동으로 싣는다 — Origin 이 우리 것이 아니면 거부."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(url, client, headers={"Origin": "https://evil.example"}):
                pass
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(url, client, headers={"Sec-Fetch-Site": "cross-site"}):
                pass
        async with aconnect_ws(url, client, headers={"Origin": "https://test"}) as ws:
            await Peer(ws).connect()  # 우리 오리진은 통과


async def test_unknown_doc_is_rejected(app: FastAPI, users: Users) -> None:
    """없는 문서는 accept 뒤 4404 — 프론트(useCollabSession)가 「지워졌다」로 판정하는 코드다."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        async with aconnect_ws(
            "https://test/api/yjs/00000000-0000-0000-0000-000000000000", client
        ) as ws:
            await expect_close(ws, 4404)


async def test_last_leaver_save_failure_is_retried(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """#340 H4: 마지막 사람이 나갈 때 저장이 실패하면 방을 되돌려 놓고 뒤에서 다시 저장한다 — 편집이 사라지지 않는다."""
    from app.realtime import yjs as mod

    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        real_scope = mod.session_scope
        failures = {"n": 0}

        class Down:
            async def __aenter__(self):
                failures["n"] += 1
                raise RuntimeError("connection refused")

            async def __aexit__(self, *exc):
                return False

        def flaky():
            return Down() if failures["n"] < 1 else real_scope()

        async with aconnect_ws(url, client) as a_ws:
            a = Peer(a_ws)
            await a.connect()
            await a.edit(write_paragraph("살아야 하는 편집"))
            monkeypatch.setattr(mod, "session_scope", flaky)
            monkeypatch.setattr(mod, "RETRY_DELAYS", (1.0,))
        # 퇴장 저장은 실패했지만 방은 더러운 채 남아 있다 — 사라지지 않았다
        deadline = asyncio.get_running_loop().time() + 2.0
        while mod.pending_saves and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.02)
        assert mod.pending_saves == 0 and failures["n"] == 1
        room = ROOMS.get(uuid.UUID(doc_id))
        assert room is not None and room.dirty and not room.conns
        # 재시도가 저장하고 방을 걷는다
        await rooms_empty(timeout=3.0)
        assert ROOMS == {}
        row = (await app_db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        await app_db.refresh(row)
        assert row.text_cache == "살아야 하는 편집"


async def test_save_skips_trashed_doc_and_closes_room(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """#340 보안 리뷰: 저장은 살아 있는 행만 바꾼다 — 저장 사이에 휴지통으로 간 문서는 덮어쓰지 않고(updated_by 가
    지운 사람으로 남는다) 방을 걷어 접속자를 4404 로 닫는다. 퇴장 저장 실패 → 복구된 방이 지운 문서를 되살리는
    경합도 이 한 줄이 막는다."""
    from app.realtime import yjs as mod

    monkeypatch.setattr(mod, "SAVE_INTERVAL", timedelta(0))  # 편집마다 바로 저장
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as a_ws:
            a = Peer(a_ws)
            await a.connect()
            # close_room 을 거치지 않고 행만 휴지통으로 — 저장 도중 끼어든 삭제를 흉내 낸다
            await app_db.execute(
                update(Document)
                .where(Document.id == doc_id)
                .values(deleted_at=datetime.now(UTC), updated_by=users.exec.id)
            )
            await app_db.flush()
            await a.edit(
                write_paragraph("지워질 문서의 편집")
            )  # 서버가 저장을 시도 → 0행 → 방을 걷는다
            await expect_close(a_ws, 4404)
        await rooms_empty()
        row = (await app_db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        await app_db.refresh(row)
        assert row.text_cache != "지워질 문서의 편집" and row.updated_by == users.exec.id


async def test_failed_last_save_merges_into_room_opened_meanwhile(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """#340 H4 양보 분기: 마지막 퇴장 저장이 실패하는 사이 다른 사람이 새 방을 열었으면(DB 는 실패한 편집 전),
    옛 방의 편집을 새 방에 합쳐 방송한다 — 새 방 사람이 받고, 그 사람이 나갈 때 DB 에 남는다."""
    from app.realtime import yjs as mod

    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        real_scope = mod.session_scope
        entered = asyncio.Event()
        gate = asyncio.Event()
        failures = {"n": 0}

        class Down:
            async def __aenter__(self):
                failures["n"] += 1
                entered.set()
                await gate.wait()  # 저장이 느린 사이 — 이때 B 가 새 방을 연다
                raise RuntimeError("connection refused")

            async def __aexit__(self, *exc):
                return False

        async with aconnect_ws(url, client) as a_ws:
            a = Peer(a_ws)
            await a.connect()
            await a.edit(write_paragraph("살아야 하는 편집"))
            # 접속·편집이 끝난 뒤에 끼운다 — 핸드셰이크의 authenticate 도 session_scope 를 쓴다
            monkeypatch.setattr(
                mod, "session_scope", lambda: Down() if failures["n"] < 1 else real_scope()
            )
            # 서버가 A 를 닫게 한다(상한 초과 프레임 → 1009) — 핸들러의 finally 가 퇴장 저장에 들어가 Down 에서 멎는다
            await a_ws.send_bytes(bytes(mod.MAX_FRAME + 1))
            await asyncio.wait_for(entered.wait(), 3.0)
            async with aconnect_ws(url, client) as b_ws:
                b = Peer(b_ws)
                await b.connect()
                assert b.text == ""  # 새 방은 실패한 편집을 모른다(DB 는 편집 전)
                gate.set()  # 이제 A 의 저장이 실패한다 → 옛 방의 편집이 B 의 방에 합쳐져 방송된다
                await b.pump(0.6)
                assert b.text == "살아야 하는 편집"
        assert failures["n"] == 1
        await rooms_empty()
        row = (await app_db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        await app_db.refresh(row)
        assert row.text_cache == "살아야 하는 편집"


async def test_silent_socket_is_reauthenticated(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """#340 M1: 아무것도 안 보내는 yjs 소켓도 주기마다 세션을 다시 본다 — 회수되면 4401 로 닫힌다."""
    from datetime import UTC, datetime

    from sqlalchemy import update

    from app.models import AuthSession
    from app.realtime import yjs as mod

    monkeypatch.setattr(mod, "REAUTH_INTERVAL", timedelta(seconds=0.3))
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as ws:
            await Peer(ws).connect()
            await asyncio.sleep(0.4)  # 유효한 세션은 재검증을 지나도 살아 있다
            await app_db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users.member.id)
                .values(revoked_at=datetime.now(UTC))
            )
            await app_db.flush()
            await expect_close(ws, 4401)
        await rooms_empty()


async def test_two_peers_converge_and_server_persists(app: FastAPI, users: Users, app_db) -> None:
    """TC-DOC-02: 한쪽 편집이 다른 쪽에 반영되고, 방이 닫히면 Y.Doc·제목·평문이 DB 에 남는다."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"

        async with aconnect_ws(url, client) as a_ws, aconnect_ws(url, client) as b_ws:
            a, b = Peer(a_ws), Peer(b_ws)
            await a.connect()
            await b.connect()
            await a.edit(write_paragraph("첫 문단 <b> 그대로"))
            await a.edit(lambda d: d.get("meta", type=Map).__setitem__("title", "  로드맵  "))
            await b.pump()
            assert b.text == "첫 문단 <b> 그대로"
            assert b.title == "  로드맵  "
            await b.edit(write_paragraph("둘째"))
            await a.pump()
            assert a.text == b.text == "첫 문단 <b> 그대로둘째"
            assert len(ROOMS) == 1 and next(iter(ROOMS.values())).dirty

        await rooms_empty()
        row = (await app_db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        await app_db.refresh(row)
        assert row.ydoc_snapshot and row.title == "로드맵"
        assert row.text_cache == "첫 문단 <b> 그대로\n둘째"  # 본문의 '<b>' 는 태그가 아니라 글자다
        assert row.tsv is not None

        # 새 방은 DB 스냅샷에서 열린다 — 재접속한 사람이 내용을 그대로 받는다 (FR-DOC-03)
        async with aconnect_ws(url, client) as c_ws:
            c = Peer(c_ws)
            await c.connect()
            assert c.text == "첫 문단 <b> 그대로둘째"
            assert c.title == "  로드맵  "


async def test_awareness_relayed_and_cleared_on_disconnect(
    app: FastAPI, users: Users, app_db
) -> None:
    """TC-DOC-04: 커서·이름이 전파되고, 끊긴 사람의 커서는 남은 사람 화면에서 사라진다."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"

        async with aconnect_ws(url, client) as b_ws:
            b = Peer(b_ws)
            await b.connect()
            async with aconnect_ws(url, client) as a_ws:
                a = Peer(a_ws)
                await a.connect()
                a.awareness.set_local_state({"user": {"name": "김수진"}})
                await a_ws.send_bytes(
                    create_awareness_message(a.awareness.encode_awareness_update([a.doc.client_id]))
                )
                await b.pump()
                assert b.awareness.states[a.doc.client_id] == {"user": {"name": "김수진"}}
                # 늦게 온 사람도 이미 있는 참여자를 받는다
                async with aconnect_ws(url, client) as late_ws:
                    late = Peer(late_ws)
                    await late.connect()
                    assert a.doc.client_id in late.awareness.states
            await b.pump()
            assert a.doc.client_id not in b.awareness.states


async def test_trashed_doc_and_garbage_frames(app: FastAPI, users: Users, app_db) -> None:
    """휴지통 문서는 소켓으로 열 수 없고, 깨진 프레임은 자기 연결만 닫는다."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        async with aconnect_ws(url, client) as b_ws, aconnect_ws(url, client) as bad_ws:
            b, bad = Peer(b_ws), Peer(bad_ws)
            await b.connect()
            await bad.connect()  # 접속 직후 오는 step1 을 먼저 소화해야 그다음 수신이 '닫힘' 이다
            await bad_ws.send_bytes(bytes([0]))  # 종류만 있고 본문이 없다
            with pytest.raises(Exception):  # noqa: B017 — 닫힘의 형태(예외 종류)는 전송층이 정한다
                await asyncio.wait_for(bad_ws.receive_bytes(), timeout=1)
            assert len(ROOMS) == 1 and len(next(iter(ROOMS.values())).conns) == 1  # 방은 살아 있다
            await b.edit(write_paragraph("멀쩡"))
            assert b.text == "멀쩡"
        await rooms_empty()
        assert (await client.delete(f"/api/docs/{doc_id}", headers=csrf(client))).status_code == 204
        async with aconnect_ws(url, client) as ws:  # 휴지통 문서도 없는 문서와 같은 4404(#340)
            await expect_close(ws, 4404)


async def test_revoked_session_closes_socket_on_next_edit(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """11 I15: 로그아웃하면 열려 있던 소켓도 다음 편집에서 닫힌다."""
    from app.realtime import yjs as mod

    monkeypatch.setattr(mod, "REAUTH_INTERVAL", timedelta(seconds=0))
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as ws:
            a = Peer(ws)
            await a.connect()
            await a.edit(write_paragraph("아직 됨"))
            await a.pump(0.2)
            assert (await client.post("/api/auth/logout", headers=csrf(client))).status_code == 204
            await a.edit(write_paragraph("이건 안 됨"))
            with pytest.raises(Exception):  # noqa: B017
                await asyncio.wait_for(ws.receive_bytes(), timeout=1)


async def test_title_projection_does_not_undo_tree_rename(
    app: FastAPI, users: Users, app_db
) -> None:
    """트리에서 PATCH 로 바꾼 제목은 Y.Doc 의 meta.title 이 안 바뀐 한 저장이 되돌리지 않는다. 편집자는 updated_by 에."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        async with aconnect_ws(url, client) as a_ws:
            a = Peer(a_ws)
            await a.connect()
            await a.edit(lambda d: d.get("meta", type=Map).__setitem__("title", "에디터 제목"))
            await a.edit(write_paragraph("본문"))
        await rooms_empty()
        assert (await client.get(f"/api/docs/{doc_id}")).json()["title"] == "에디터 제목"

        await login(client, "donghyun@zenith.co.kr")
        r = await client.patch(
            f"/api/docs/{doc_id}", json={"title": "트리에서 바꿈"}, headers=csrf(client)
        )
        assert r.status_code == 200
        async with aconnect_ws(url, client) as b_ws:
            b = Peer(b_ws)
            await b.connect()
            await b.edit(write_paragraph("한 줄 더"))  # meta.title 은 그대로
        await rooms_empty()
        row = (await client.get(f"/api/docs/{doc_id}")).json()
        assert row["title"] == "트리에서 바꿈"
        assert row["updated_by"]["name"] == "박동현"  # 마지막 편집자


async def test_hard_delete_closes_open_sockets(app: FastAPI, users: Users, app_db) -> None:
    """살아 있는 문서의 ?hard=1 은 409 로 거절되고 방은 그대로(#278). 휴지통에 보내면 방이 걷히고 그 뒤 영구 삭제."""
    async with ws_client(app) as client:
        await login(client, "jaeho@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as ws:
            a = Peer(ws)
            await a.connect()
            r = await client.delete(f"/api/docs/{doc_id}", params={"hard": 1}, headers=csrf(client))
            assert (r.status_code, r.json()["code"]) == (409, "NOT_TRASHED")
            assert uuid.UUID(doc_id) in ROOMS  # 거절됐으니 편집 방도 그대로
            r = await client.delete(f"/api/docs/{doc_id}", headers=csrf(client))
            assert r.status_code == 204
            with pytest.raises(Exception):  # noqa: B017
                await asyncio.wait_for(ws.receive_bytes(), timeout=1)
        assert ROOMS == {}
        r = await client.delete(f"/api/docs/{doc_id}", params={"hard": 1}, headers=csrf(client))
        assert r.status_code == 204


async def test_trashing_closes_open_room(app: FastAPI, users: Users, app_db) -> None:
    """휴지통으로 보내면 열려 있던 방도 걷는다 — 안 걷으면 편집자의 주기 저장이 "지운 사람"을 덮어쓴다."""
    async with ws_client(app) as editor, ws_client(app) as remover:
        await login(editor, "sujin@zenith.co.kr")
        await login(remover, "donghyun@zenith.co.kr")
        doc_id = await _doc_id(editor, app_db)
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", editor) as ws:
            a = Peer(ws)
            await a.connect()
            await a.edit(write_paragraph("편집 중"))
            r = await remover.delete(f"/api/docs/{doc_id}", headers=csrf(remover))
            assert r.status_code == 204
            with pytest.raises(Exception):  # noqa: B017 — 닫힘의 형태는 전송층이 정한다
                await asyncio.wait_for(ws.receive_bytes(), timeout=1)
        assert ROOMS == {}

        row = (await remover.get(f"/api/docs/{doc_id}")).json()
        assert row["deleted_at"] is not None
        assert row["updated_by"]["name"] == "박동현"  # 편집자가 아니라 지운 사람


async def test_periodic_save_while_others_stay(
    app: FastAPI, users: Users, app_db, monkeypatch
) -> None:
    """SAVE_INTERVAL 마다, 그리고 한 명이 나갈 때 — 방이 살아 있어도 저장된다."""
    from app.realtime import yjs as mod

    monkeypatch.setattr(mod, "SAVE_INTERVAL", timedelta(seconds=0))
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        url = f"https://test/api/yjs/{doc_id}"
        async with aconnect_ws(url, client) as b_ws:
            b = Peer(b_ws)
            await b.connect()
            async with aconnect_ws(url, client) as a_ws:
                a = Peer(a_ws)
                await a.connect()
                await a.edit(write_paragraph("첫 저장"))
                await b.pump(0.2)
                assert (await client.get(f"/api/docs/{doc_id}")).json()["ydoc"] is not None
                await a.edit(write_paragraph("둘째"))
            await b.pump(0.2)  # A 퇴장 — 방은 B 로 살아 있지만 저장은 됐다
            assert len(ROOMS) == 1
            row = (await app_db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
            await app_db.refresh(row)
            assert row.text_cache == "첫 저장\n둘째"
            assert not next(iter(ROOMS.values())).dirty


async def test_empty_update_is_not_persisted(app: FastAPI, users: Users, app_db) -> None:
    """읽기만 하고 나가면 문서를 더럽히지 않는다 — updated_at 이 움직이지 않는다."""
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        before = (await client.get(f"/api/docs/{doc_id}")).json()["updated_at"]
        async with aconnect_ws(f"https://test/api/yjs/{doc_id}", client) as ws:
            await Peer(ws).connect()
        await rooms_empty()
        assert (await client.get(f"/api/docs/{doc_id}")).json()["updated_at"] == before
