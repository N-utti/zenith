"""04-API §4.2 `/api/yjs/{doc_id}` — y-websocket 프로토콜 릴레이 + Y.Doc 영속화.

명세는 frontend/scripts/collab.js(개발 릴레이)와 같다: 바이너리 프레임, 첫 varuint 가 종류(0 sync / 1 awareness).
문서마다 Y.Doc 을 하나 들고 받은 업데이트를 적용한 뒤 같은 방의 나머지 연결에 그대로 중계한다.
차이는 영속화다 — `documents.ydoc_snapshot` 이 본문의 원본(03 §2.1)이고, 제목·검색용 평문(text_cache·tsv)은
저장 시점에 Y.Doc 에서 파생한다. gc 는 끄는다(skip_gc) — 클라이언트와 맞춰야 과거 스냅샷을 복원할 수 있다.

인증은 쿠키(11 §7.5 · TC-SEC-03) — `deps.authenticate(websocket.cookies, db)`. `?token=` 은 받지 않는다.
브라우저는 소켓 핸드셰이크에 쿠키를 자동으로 싣고 CORS 를 적용하지 않으므로 출처는 서버가 대조한다(origin_allowed).
ARCHITECTURE §7 의 별도 yjs 컨테이너·Caddy forward_auth 는 필요 없어졌다(API 프로세스 안에 있다).

DB 세션은 소켓 수명 동안 붙잡지 않는다 — 핸드셰이크·저장·재검증 때만 짧게 연다(idle in transaction 으로
커넥션 풀을 말리지 않게). 그래서 요청 의존성(get_db)이 아니라 세션 팩토리를 쓴다.

ponytail: 방(room)은 프로세스 메모리에 있다 — uvicorn 은 worker 1개로 띄운다. 다중 프로세스가 필요해지면
문서별 sticky 라우팅이나 Redis 중계가 먼저 와야 한다.
"""

import asyncio
import contextlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pycrdt import (
    Awareness,
    Doc,
    Encoder,
    Map,
    XmlFragment,
    XmlText,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    handle_sync_message,
    read_message,
)
from sqlalchemy import func, update

from app.db import session_scope
from app.deps import _own_origin, authenticate, origin_allowed
from app.errors import ApiError
from app.models import Document

log = logging.getLogger("zenith.yjs")

# ARCHITECTURE §5 "30초마다 스냅샷을 Postgres 에 저장". 활동이 있을 때 이 간격으로, 마지막 사람이 나갈 때 한 번 더.
SAVE_INTERVAL = timedelta(seconds=30)
# 세션 회수(로그아웃·비활성화·비밀번호 변경)가 열린 소켓에도 먹게 — 편집이 올 때 이 간격으로 쿠키를 다시 검사한다.
REAUTH_INTERVAL = timedelta(seconds=60)
# 프레임 하나의 상한. Yjs 업데이트는 편집 단위라 수 KB 다 — 1MB 는 붙여넣기 폭탄까지 넉넉하다.
MAX_FRAME = 1_000_000
SEND_TIMEOUT = 5  # 초. 읽기를 멈춘 연결 하나가 방 전체를 세우지 않게
EMPTY_UPDATE = b"\x00\x00"


@dataclass
class Room:
    doc_id: uuid.UUID
    doc: Doc
    awareness: Awareness
    conns: dict[WebSocket, set[int]] = field(default_factory=dict)  # 연결 → awareness client id 들
    dirty: bool = False
    saved_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    projected_title: str | None = (
        None  # 마지막으로 DB 에 투영한 meta.title — 트리에서 바꾼 제목을 되돌리지 않게
    )
    last_editor: uuid.UUID | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def title(self) -> str | None:
        value = self.doc.get("meta", type=Map).get("title")
        return value.strip()[:200] or None if isinstance(value, str) else None

    @property
    def text(self) -> str:
        return _plain_text(self.doc.get("default", type=XmlFragment))


def _plain_text(node, depth: int = 0) -> str:
    """검색용 평문. 태그를 훑지 않고 XmlText 만 모은다 — str(XmlFragment) 는 본문의 '<' 를 이스케이프하지 않는다."""
    if isinstance(node, XmlText):
        return str(node)
    if depth > 64:
        return ""  # 악의적으로 깊은 중첩 — 검색 평문에서 그 아래는 버린다
    return "\n".join(_plain_text(child, depth + 1) for child in node.children).strip()


def _removal_message(awareness: Awareness, client_ids: set[int]) -> bytes:
    """끊긴 연결의 커서를 지우는 awareness 메시지 — y-protocols 대로 상태 null + clock+1.

    pycrdt 의 encode_awareness_update 는 이미 지운 client 를 인코딩하지 못해 직접 만든다.
    """
    encoder = Encoder()
    encoder.write_var_uint(len(client_ids))
    for client_id in client_ids:
        encoder.write_var_uint(client_id)
        encoder.write_var_uint(awareness.meta.get(client_id, {}).get("clock", 0) + 1)
        encoder.write_var_string("null")
    return create_awareness_message(encoder.to_bytes())


ROOMS: dict[uuid.UUID, Room] = {}
_rooms_lock = asyncio.Lock()
pending_saves = (
    0  # 방을 걷은 뒤 아직 끝나지 않은 퇴장 저장 수 — 테스트가 "다 끝났다" 를 기다리는 기준
)


async def _open_room(doc_id: uuid.UUID) -> Room | None:
    # ponytail: 잠금이 DB 왕복까지 덮어 모든 문서의 첫 접속이 직렬화된다. 15명 규모에선 무시할 값 — 문서별 잠금은 그때.
    async with _rooms_lock:
        room = ROOMS.get(doc_id)
        if room is not None:
            return room
        async with session_scope() as db:
            row = await db.get(Document, doc_id)
            if row is None or row.deleted_at is not None:
                return (
                    None  # 휴지통 문서는 HTTP GET 으로만 읽는다 — 소켓으로 쓰면 색인에 되살아난다
                )
            snapshot = row.ydoc_snapshot
        # ponytail: gc 를 끄면 지운 내용까지 영구히 남아 문서가 계속 커진다(15명 위키에선 감수). 문서 총량 상한·
        # 스냅샷 압축(주기적 gc 후 새 히스토리 시작)은 크기가 문제 될 때 — 그때 버전 복원 정책도 같이 정한다.
        doc = Doc(skip_gc=True)
        if snapshot:
            doc.apply_update(snapshot)
        awareness = Awareness(doc)
        awareness.set_local_state(None)  # 서버는 참여자가 아니다 — 커서를 만들지 않는다
        room = Room(doc_id=doc_id, doc=doc, awareness=awareness)
        room.projected_title = room.title

        def on_awareness(_type: str, payload: tuple[dict, object]) -> None:
            # 어느 연결이 어느 clientId 를 들고 있는지 기록해 두어야 끊길 때 유령 커서를 지울 수 있다.
            # 프레임이 주장한 clientId 를 믿는다 — 남의 id 를 사칭하면 그 커서 라벨을 바꾸거나 지울 수 있지만
            # 표시용 정보라 감수한다(문서 내용에는 못 닿는다).
            changes, origin = payload
            owned = room.conns.get(origin) if isinstance(origin, WebSocket) else None
            if owned is None:
                return
            owned.update(changes.get("added", []) + changes.get("updated", []))
            owned.difference_update(changes.get("removed", []))

        awareness.observe(on_awareness)
        ROOMS[doc_id] = room
        return room


async def save_room(room: Room) -> None:
    """Y.Doc 전체 상태를 원본으로, 제목·평문·tsv 를 파생으로 적는다(03 §2.1). 더러워진 것이 없으면 아무것도 안 한다."""
    async with room.lock:
        if not room.dirty:
            return
        room.dirty = False  # 첫 await 전에 내린다 — 커밋 중 들어온 편집이 다음 저장에 잡히게
        try:
            text = room.text
            values: dict = {
                "ydoc_snapshot": room.doc.get_update(),
                "text_cache": text,
                "tsv": func.to_tsvector("simple", text[:900_000]),  # tsvector 는 1MB 가 상한
                "updated_at": datetime.now(UTC),
            }
            if room.last_editor is not None:
                values["updated_by"] = room.last_editor
            # 제목은 Y.Doc 의 meta.title 이 바뀌었을 때만 투영한다. 그래야 트리에서 PATCH 로 바꾼 제목을 되돌리지 않는다.
            title = room.title
            if title is not None and title != room.projected_title:
                values["title"] = title
            async with session_scope() as db:
                try:
                    await db.execute(
                        update(Document).where(Document.id == room.doc_id).values(**values)
                    )
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise
            if title is not None:
                room.projected_title = title
            room.saved_at = datetime.now(UTC)
        except Exception:
            room.dirty = True  # 실패했으니 다음 기회에 다시
            raise


async def _send(room: Room, conn: WebSocket, message: bytes) -> None:
    try:
        async with asyncio.timeout(SEND_TIMEOUT):
            await conn.send_bytes(message)
    except Exception:  # noqa: BLE001 — 못 따라오는 연결은 방에서 빼고 닫는다. 나머지 정리는 그쪽 finally 가
        room.conns.pop(conn, None)
        with contextlib.suppress(Exception):
            await conn.close(code=1011)


async def _broadcast(room: Room, message: bytes, *, exclude: WebSocket | None) -> None:
    # 동시에 보낸다 — 느린 연결 하나가 나머지의 수신을 늦추지 않게.
    await asyncio.gather(
        *(_send(room, conn, message) for conn in list(room.conns) if conn is not exclude)
    )


async def close_room(doc_id: uuid.UUID) -> None:
    """문서가 영구 삭제될 때 — 방을 걷고 접속 중인 소켓을 닫는다. 저장은 하지 않는다(행이 없다)."""
    async with _rooms_lock:
        room = ROOMS.pop(doc_id, None)
    if room is None:
        return
    for conn in list(room.conns):
        with contextlib.suppress(Exception):
            await conn.close(code=4404)
    room.conns.clear()


async def _leave(room: Room, websocket: WebSocket) -> None:
    owned = room.conns.pop(websocket, set())
    if owned:
        room.awareness.remove_awareness_states(list(owned), origin=None)
        await _broadcast(room, _removal_message(room.awareness, owned), exclude=None)
        for (
            client_id
        ) in owned:  # pycrdt 는 states 만 지우고 meta 를 남긴다 — 새로고침마다 새 id 라 쌓인다
            room.awareness.meta.pop(client_id, None)
    async with _rooms_lock:
        # 마지막 사람이면 방을 먼저 걷는다 — 저장이 양보하는 사이 새 접속이 사라질 방에 들어오지 않게.
        last = not room.conns and ROOMS.get(room.doc_id) is room
        if last:
            ROOMS.pop(room.doc_id, None)
    if last or room.dirty:
        global pending_saves
        pending_saves += 1
        try:
            await save_room(room)
        except Exception:
            log.exception("yjs 저장 실패 %s", room.doc_id)
        finally:
            pending_saves -= 1


async def yjs_endpoint(websocket: WebSocket, doc_id: uuid.UUID) -> None:
    if not origin_allowed(websocket.headers, _own_origin(websocket)):
        log.info("yjs 거부 %s: CSRF_ORIGIN %s", doc_id, websocket.headers.get("origin"))
        await websocket.close(code=4403)
        return
    try:
        async with session_scope() as db:
            user, _session = await authenticate(websocket.cookies, db)
    except ApiError as e:
        log.info("yjs 거부 %s: %s", doc_id, e.code)
        await websocket.close(code=4401)  # TC-SEC-03: 쿠키 없이는 핸드셰이크에서 거부
        return
    room = await _open_room(doc_id)
    if room is None:
        log.info("yjs 거부 %s: NOT_FOUND", doc_id)
        await websocket.close(code=4404)
        return

    await websocket.accept()
    room.conns[websocket] = set()
    checked_at = datetime.now(UTC)
    try:
        # 접속하자마자 서버 상태를 물어보고(step1), 이미 있는 참여자들을 알려 준다.
        await websocket.send_bytes(create_sync_message(room.doc))
        if others := list(room.awareness.states):
            await websocket.send_bytes(
                create_awareness_message(room.awareness.encode_awareness_update(others))
            )
        while True:
            message = await websocket.receive_bytes()
            if not message:
                continue
            if len(message) > MAX_FRAME:
                await websocket.close(code=1009)
                break
            if datetime.now(UTC) - checked_at >= REAUTH_INTERVAL:
                async with session_scope() as db:
                    # 회수됐으면 ApiError → 아래서 닫힌다. exp 는 안 본다(deps.authenticate 참조)
                    await authenticate(websocket.cookies, db, verify_exp=False)
                checked_at = datetime.now(UTC)
            kind = message[0]
            if kind == YMessageType.SYNC:
                reply = handle_sync_message(message[1:], room.doc)  # step1 이면 step2 를 돌려준다
                if reply is not None:
                    await websocket.send_bytes(reply)
                if len(message) > 2 and message[1] in (
                    YSyncMessageType.SYNC_STEP2,
                    YSyncMessageType.SYNC_UPDATE,
                ):
                    if read_message(message[2:]) == EMPTY_UPDATE:
                        continue  # 적용은 pycrdt 가 이미 건너뛴다 — 남에게 뿌리지만 않는다
                    room.dirty = True
                    room.last_editor = user.id
                    await _broadcast(
                        room, message, exclude=websocket
                    )  # 보낸 쪽에는 되돌려 주지 않는다
                    if datetime.now(UTC) - room.saved_at >= SAVE_INTERVAL:
                        await save_room(room)
            elif kind == YMessageType.AWARENESS:
                room.awareness.apply_awareness_update(read_message(message[1:]), origin=websocket)
                # 보낸 쪽에도 돌려준다 — y-websocket 은 30초 동안 아무 메시지도 못 받으면(자기 awareness 포함)
                # 소켓을 닫는다. 혼자 편집하는 사람이 30초마다 끊기지 않게.
                await _broadcast(room, message, exclude=None)
    except WebSocketDisconnect:
        pass
    except ApiError as e:
        log.info("yjs 세션 종료 %s: %s", doc_id, e.code)
        with contextlib.suppress(Exception):
            await websocket.close(code=4401)
    except Exception as e:  # noqa: BLE001
        # 잘린 varuint·빈 프레임·TEXT 프레임·깨진 awareness JSON 같은 입력, 또는 저장 실패. 자기 연결만 닫고 방은 살린다.
        log.info("yjs 연결 종료 %s: %s %s", doc_id, type(e).__name__, e)
        with contextlib.suppress(Exception):
            await websocket.close(code=1003)
    finally:
        await _leave(room, websocket)


def register(app: FastAPI) -> None:
    # api 라우터의 csrf_guard 는 HTTP 요청 전용이라 라우터 밖에 건다. 출처 대조는 핸드셰이크에서
    # origin_allowed 로 따로 한다(브라우저는 소켓에 쿠키를 자동으로 싣는다). 경로는 04 대로 /api 아래.
    app.add_api_websocket_route("/api/yjs/{doc_id}", yjs_endpoint)
