"""04-API §4.2 /yjs — FR-DOC-02·03 · TC-DOC-02·04 · TC-SEC-03. 클라이언트는 pycrdt 로 y-websocket 프로토콜을 흉내 낸다."""

import asyncio
import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import HTTPXWSException, aconnect_ws
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
from sqlalchemy import select

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


async def test_rejects_without_cookie(app: FastAPI, users: Users, app_db) -> None:
    """TC-SEC-03: 쿠키 없이는 핸드셰이크에서 거부. ?token= 도 소용없다."""
    async with ws_client(app) as client, ws_client(app) as anon:
        await login(client, "sujin@zenith.co.kr")
        doc_id = await _doc_id(client, app_db)
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(f"https://test/api/yjs/{doc_id}?token=x", anon):
                pass
        assert doc_id not in {str(k) for k in ROOMS}


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
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(
                "https://test/api/yjs/00000000-0000-0000-0000-000000000000", client
            ):
                pass


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
        with pytest.raises(HTTPXWSException):
            async with aconnect_ws(url, client):
                pass


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
