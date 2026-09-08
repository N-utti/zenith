"""04-API §4.1 `/api/ws` — 채팅·알림·presence 단일 소켓.

프레임은 JSON 텍스트. 클라이언트 → 서버 `{"op": sub|msg|read|typing, ...}`, 서버 → 클라이언트
`{"ev": msg|unread|notice|presence|typing|error, ...}`. 04 에 없는 `typing`·`error` 이벤트는 구현이 더했다(README).

구독 범위는 `sub` 가 아니라 DB 의 channel_members 가 정한다 — 내가 멤버인 채널의 일은 전부 받고, `sub` 는
받아들이되 아무것도 바꾸지 않는다. 소켓이 "무엇을 구독했다" 고 주장하는 것과 권한이 어긋날 수 없게.
멤버가 아닌 채널에 쓰면 `error FORBIDDEN` + 감사 `acl.denied`(04 §9 — HTTP 의 403 과 같은 취급).

인증·출처·재검증은 yjs.py 와 같다: 쿠키 핸드셰이크(`?token=` 없음), Origin 대조(Cross-Site WebSocket
Hijacking), 60초마다 세션 재검증 — 여기서는 조용한 소켓도 검사한다(회수된 세션이 남의 메시지를 계속 받으면
안 된다). DB 세션은 op 하나를 처리하는 동안만 연다.

ponytail: 소켓 목록은 프로세스 메모리 — uvicorn worker 1개 전제(yjs 와 같음). 다중 프로세스는 Redis pub/sub 이 먼저.
ponytail: 소켓당 레이트리밋이 없다 — 멤버가 msg·typing 을 고빈도로 쏘면 op 마다 DB 왕복·브로드캐스트가 그대로 돈다.
15명 사내망에선 감수. 필요해지면 소켓당 슬라이딩 윈도 카운터 하나(초과는 1008 로 닫기).
ponytail: 같은 채널에 두 사람이 정확히 동시에 쓰면 먼저 커밋한 쪽의 unread 방송이 1 작을 수 있다 — 다음 이벤트에서
정정된다. 채널별 asyncio.Lock 으로 직렬화하면 없어지지만 지금은 안 한다.
"""

import asyncio
import contextlib
import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import session_scope
from app.deps import _own_origin, authenticate, origin_allowed
from app.errors import ApiError
from app.models import ChannelMember, Document, Message, Notification, User

log = logging.getLogger("zenith.ws")

REAUTH_INTERVAL = timedelta(seconds=60)
MAX_FRAME = 64_000  # 본문 1만 자(UTF-8 최대 4바이트) + 봉투. 그보다 크면 프로토콜 위반으로 닫는다
SEND_TIMEOUT = 5  # 초. 읽기를 멈춘 탭 하나가 나머지의 수신을 세우지 않게
MENTION = re.compile(r"@(\S+)")

SOCKETS: dict[uuid.UUID, set[WebSocket]] = {}  # 사용자 → 열린 소켓들(탭마다 하나)

Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]


class SubOp(BaseModel):
    op: Literal["sub"]
    channels: list[str] = Field(default_factory=list, max_length=100)


class MsgOp(BaseModel):
    op: Literal["msg"]
    channel_id: uuid.UUID
    body: Body
    doc_ref: uuid.UUID | None = None  # 문서 카드 (FR-DOC-07)


class ReadOp(BaseModel):
    op: Literal["read"]
    channel_id: uuid.UUID


class TypingOp(BaseModel):
    op: Literal["typing"]
    channel_id: uuid.UUID


ClientOp = TypeAdapter(Annotated[SubOp | MsgOp | ReadOp | TypingOp, Field(discriminator="op")])


def _dumps(event: dict) -> str:
    return json.dumps(jsonable_encoder(event), ensure_ascii=False)


async def _send(ws: WebSocket, text: str) -> None:
    try:
        async with asyncio.timeout(SEND_TIMEOUT):
            await ws.send_text(text)
    except Exception:  # noqa: BLE001 — 못 따라오는 소켓은 목록에서 빼고 닫는다. 나머지 정리는 그쪽 finally 가
        _forget(ws)
        with contextlib.suppress(Exception):
            await ws.close(code=1011)


def _forget(ws: WebSocket) -> None:
    conns = SOCKETS.get(getattr(ws.state, "user_id", None))
    if conns is not None:
        conns.discard(ws)


async def push(user_ids, event: dict, *, exclude: WebSocket | None = None) -> None:
    """이벤트 하나를 여러 사용자의 모든 탭으로. 동시에 보낸다 — 느린 소켓 하나가 나머지를 늦추지 않게."""
    text = _dumps(event)
    targets = [
        ws for uid in set(user_ids) for ws in list(SOCKETS.get(uid, ())) if ws is not exclude
    ]
    if targets:
        await asyncio.gather(*(_send(ws, text) for ws in targets))


async def push_notice(notification: Notification) -> None:
    """알림 행 하나를 그 사용자의 열린 소켓들로(04 §4.1 notice). 행은 호출한 쪽이 commit 했어야 한다."""
    await push(
        [notification.user_id],
        {
            "ev": "notice",
            "id": notification.id,
            "kind": notification.kind,
            "payload": notification.payload,
            "created_at": notification.created_at,
        },
    )


async def mention_targets(db: AsyncSession, body: str, author_id: uuid.UUID) -> list[User]:
    """`@이름` 토큰을 활성 사용자 이름과 정확히 맞춘다 — 동명이인은 전부, 글쓴이 자신은 제외.

    ponytail: 문서 댓글(FR-DOC-04)과 채팅(FR-CHT-02)이 같이 쓴다. 프론트 자동완성이 id 를 실어 보내게 되면 `@[id]` 로.
    """
    # 앞 50개만 — 본문을 @토큰으로 채워 IN 절·알림 수를 부풀리지 못하게
    names = {m.rstrip(".,!?:;)") for m in MENTION.findall(body)[:50]}
    if not names:
        return []
    rows = await db.execute(
        select(User).where(User.name.in_(names), User.active.is_(True), User.id != author_id)
    )
    return list(rows.scalars())


async def _members(db: AsyncSession, channel_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == channel_id)
    )
    return set(rows.scalars())


async def _unread_counts(db: AsyncSession, channel_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """채널 멤버 전원의 안 읽음 수 — 03 §2.3, 홈(me.py)과 같은 기준이라 배지 3곳이 일치한다(FR-CHT-03)."""
    rows = await db.execute(
        select(ChannelMember.user_id, func.count(Message.id))
        .select_from(ChannelMember)
        .outerjoin(
            Message,
            (Message.channel_id == ChannelMember.channel_id)
            & (Message.author_id != ChannelMember.user_id)
            & (
                (ChannelMember.last_read_at.is_(None))
                | (Message.created_at > ChannelMember.last_read_at)
            ),
        )
        .where(ChannelMember.channel_id == channel_id)
        .group_by(ChannelMember.user_id)
    )
    return dict(rows.all())


def _error(code: str, detail, **extra) -> dict:
    return {"ev": "error", "code": code, "detail": detail, **extra}


async def _handle(ws: WebSocket, user: User, op: SubOp | MsgOp | ReadOp | TypingOp) -> None:
    if isinstance(op, SubOp):
        return  # 구독 범위는 멤버십이 정한다 — 받아들이기만
    events: list[tuple[list[uuid.UUID], dict]] = []  # (받을 사람들, 이벤트) — commit 뒤에 보낸다
    notices: list[Notification] = []
    async with session_scope() as db:
        members = await _members(db, op.channel_id)
        if user.id not in members:  # 없는 채널도 같은 답 — 존재를 새지 않는다
            # 감사는 소켓당 (채널, op) 조합마다 한 번 — 프레임 하나에 행 하나씩 쌓이면 표가 폭주한다
            if (op.channel_id, op.op) not in ws.state.denied:
                ws.state.denied.add((op.channel_id, op.op))
                audit.record(
                    db,
                    "acl.denied",
                    request=ws,
                    actor_id=user.id,
                    target_id=op.channel_id,
                    detail={"path": "/api/ws", "op": op.op},
                )
                await db.commit()
            await _send(
                ws, _dumps(_error("FORBIDDEN", "권한이 부족합니다.", channel_id=op.channel_id))
            )
            return
        # 서버 now() 는 트랜잭션 시각이라 읽음 시각과 섞이면 순서가 뒤집힌다(03 §2.7) — 앱 시각으로
        now = datetime.now(UTC)
        if isinstance(op, MsgOp):
            if op.doc_ref is not None:
                doc = await db.get(Document, op.doc_ref)
                if doc is None or doc.deleted_at is not None:
                    await _send(
                        ws,
                        _dumps(
                            _error(
                                "VALIDATION",
                                "카드로 붙일 문서가 없습니다.",
                                channel_id=op.channel_id,
                            )
                        ),
                    )
                    return
            message = Message(
                channel_id=op.channel_id,
                author_id=user.id,
                body=op.body,
                doc_ref=op.doc_ref,
                created_at=now,
            )
            db.add(message)
            # 보낸 사람은 그 채널을 보고 있다 — 자기 글 이전 것까지 읽은 것으로
            await db.execute(
                update(ChannelMember)
                .where(ChannelMember.channel_id == op.channel_id, ChannelMember.user_id == user.id)
                .values(last_read_at=now)
            )
            await db.flush()  # id 를 받는다
            # 채널 밖 사람에게 열 수 없는 채널을 가리키는 알림은 만들지 않는다
            for target in await mention_targets(db, op.body, user.id):
                if target.id in members:
                    notices.append(
                        Notification(
                            user_id=target.id,
                            kind="mention",
                            created_at=now,
                            payload={
                                "channel_id": str(op.channel_id),
                                "message_id": str(message.id),
                                "from": {"id": str(user.id), "name": user.name},
                                "preview": op.body[:120],
                            },
                        )
                    )
            db.add_all(notices)
            await db.commit()
            # commit 뒤라야 동시에 들어온 남의 글까지 센다 — 같은 트랜잭션 안에서는 자기 글만 보인다
            counts = await _unread_counts(db, op.channel_id)
            events.append(
                (
                    list(members),
                    {
                        "ev": "msg",
                        "channel_id": op.channel_id,
                        "message": {
                            "id": message.id,
                            "channel_id": op.channel_id,
                            "author": {"id": user.id, "name": user.name},
                            "body": op.body,
                            "doc_ref": op.doc_ref,
                            "attachments": None,
                            "created_at": now,
                        },
                    },
                )
            )
            for uid, count in counts.items():
                events.append(
                    ([uid], {"ev": "unread", "channel_id": op.channel_id, "count": count})
                )
        elif isinstance(op, ReadOp):
            await db.execute(
                update(ChannelMember)
                .where(ChannelMember.channel_id == op.channel_id, ChannelMember.user_id == user.id)
                .values(last_read_at=now)
            )
            await db.commit()
            events.append(([user.id], {"ev": "unread", "channel_id": op.channel_id, "count": 0}))
        else:  # typing — 서버에 남기지 않고 같은 채널의 다른 사람에게 흘려보내기만
            events.append(
                (
                    [uid for uid in members if uid != user.id],
                    {
                        "ev": "typing",
                        "channel_id": op.channel_id,
                        "user_id": user.id,
                        "name": user.name,
                    },
                )
            )
    # 한꺼번에 — 잠든 탭 하나의 5초 타임아웃이 이벤트 수만큼 곱해져 보낸 사람의 루프를 세우지 않게
    await asyncio.gather(
        *(push(targets, event) for targets, event in events),
        *(push_notice(notice) for notice in notices),
    )


async def ws_endpoint(websocket: WebSocket) -> None:
    if not origin_allowed(websocket.headers, _own_origin(websocket)):
        log.info("ws 거부: CSRF_ORIGIN %s", websocket.headers.get("origin"))
        await websocket.close(code=4403)
        return
    try:
        async with session_scope() as db:
            user, _session = await authenticate(websocket.cookies, db)
    except ApiError as e:
        log.info("ws 거부: %s", e.code)
        await websocket.close(code=4401)
        return

    await websocket.accept()
    websocket.state.user_id = user.id
    websocket.state.denied = set()  # 이미 감사에 남긴 (채널, op) 거부
    checked_at = datetime.now(UTC)
    try:  # 등록부터 try 안에 — 여기서 취소돼도 finally 가 목록에서 뺀다
        conns = SOCKETS.setdefault(user.id, set())
        first = not conns
        conns.add(websocket)
        # 이미 접속 중인 사람들을 알려 주고, 내가 처음 들어왔으면(다른 탭이 없었으면) 모두에게 알린다.
        for uid in list(SOCKETS):
            if uid != user.id and SOCKETS.get(uid):
                await _send(websocket, _dumps({"ev": "presence", "user_id": uid, "online": True}))
        if first:
            await push(
                SOCKETS, {"ev": "presence", "user_id": user.id, "online": True}, exclude=websocket
            )
        while True:
            remaining = REAUTH_INTERVAL - (datetime.now(UTC) - checked_at)
            raw: str | None
            try:
                async with asyncio.timeout(max(remaining.total_seconds(), 0)):
                    raw = await websocket.receive_text()
            except TimeoutError:
                raw = None  # 조용한 소켓도 주기적으로 세션을 다시 본다
            if datetime.now(UTC) - checked_at >= REAUTH_INTERVAL:
                async with session_scope() as db:
                    # 회수·비활성이면 ApiError → 아래서 닫힌다. 소켓의 쿠키는 핸드셰이크 시점에 고정이라
                    # exp 는 안 본다(deps.authenticate) — 안 그러면 모든 소켓이 15분 안에 죽는다
                    user, _session = await authenticate(websocket.cookies, db, verify_exp=False)
                checked_at = datetime.now(UTC)
            if raw is None:
                continue
            if len(raw.encode()) > MAX_FRAME:  # 바이트 기준. 진짜 상한은 uvicorn --ws-max-size
                await websocket.close(code=1009)
                break
            try:
                op = ClientOp.validate_json(raw)
            except ValidationError as e:
                # 오타 하나로 소켓을 끊지 않는다 — 어떤 필드가 틀렸는지 돌려주고 계속. 보낸 원문은 되돌리지 않는다
                errors = [
                    {k: v for k, v in err.items() if k != "input"}
                    for err in e.errors(include_url=False)
                ]
                await _send(websocket, _dumps(_error("VALIDATION", errors)))
                continue
            await _handle(websocket, user, op)
    except WebSocketDisconnect:
        pass
    except ApiError as e:
        log.info("ws 세션 종료 %s: %s", user.id, e.code)
        with contextlib.suppress(Exception):
            await websocket.close(code=4401)
    except Exception as e:  # noqa: BLE001 — 바이너리 프레임·DB 오류 등. 자기 연결만 닫는다
        log.info("ws 연결 종료 %s: %s %s", user.id, type(e).__name__, e)
        with contextlib.suppress(Exception):
            await websocket.close(code=1003)
    finally:
        _forget(websocket)
        if not SOCKETS.get(user.id):
            SOCKETS.pop(user.id, None)
            await push(SOCKETS, {"ev": "presence", "user_id": user.id, "online": False})


def register(app: FastAPI) -> None:
    # yjs 와 같은 이유로 api 라우터 밖(csrf_guard 는 HTTP 전용). 경로는 04 대로 /api 아래.
    app.add_api_websocket_route("/api/ws", ws_endpoint)
