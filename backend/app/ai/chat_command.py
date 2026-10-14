"""채팅창 `/ai` 커맨드(README 52, 두 번째 계획 C) — 채널·DM 에 `/ai 질문` 을 보내면 시스템 계정 「AI 어시스턴트」가
그 채널에 답 메시지를 단다. **그 메시지와 그 메시지의 첨부만** 보고 채널 대화는 읽지 않는다(10-14 사용자 결정 —
채팅을 AI 에 넣지 않는다는 09-30 결정은 그대로). 근거는 규정 전문·검색 도구, 첨부는 51 의 추출기로 읽는다.

소켓 핸들러는 사용자 메시지를 저장·방송한 뒤 `spawn()` 으로 백그라운드 태스크를 띄우고 바로 돌아간다. 태스크는
자기 세션(`session_scope`)으로 돈다 — worker 1개 전제(yjs·purge 와 같다).
"""

import asyncio
import logging
import re
import secrets
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, storage
from app.ai import extract
from app.ai.provider import LLMError, get_provider
from app.config import settings
from app.db import session_scope
from app.models import ChannelMember, Message, User
from app.security import hash_password_async

log = logging.getLogger("zenith.ai")

PREFIX = "/ai"
AI_EMAIL = (
    "ai@zenith.local"  # 로그인 불가(active=false, pw_hash 사용 불가) — 메시지 작성자로만 쓴다
)
AI_NAME = "AI 어시스턴트"
MAX_COMMAND_ATTACHMENTS = 3
REPLY_TIMEOUT_S = 120.0
_tasks: set[asyncio.Task] = set()  # 이벤트 루프는 태스크를 약하게만 잡는다
_reply_slots = asyncio.Semaphore(4)  # 동시에 도는 답변 수 상한(보안 리뷰) — 넘는 건 줄을 선다


def allowed(user_id: uuid.UUID) -> bool:
    """채팅 커맨드도 같은 Claude 호출 — `/ai/chat` 과 같은 통(`_ai_calls`, 분당 AI_RATE)을 센다(보안 리뷰: 소켓에는 msg 빈도
    제한이 없어 이게 없으면 AI 한도를 통째로 비켜 간다). 넘으면 False — 호출자가 오류 프레임만 돌려주고 태스크를 안 띄운다."""
    from app.routers import ai as ai_router

    now = time.monotonic()
    calls = ai_router._ai_calls[user_id]
    while calls and now - calls[0] >= ai_router.AI_WINDOW_S:
        calls.popleft()
    if len(calls) >= ai_router.AI_RATE:
        return False
    calls.append(now)
    return True


def parse(body: str) -> str | None:
    """`/ai 질문` 이면 질문(공백 제거), 커맨드가 아니면 None. `/ai` 만 보내면 빈 문자열(첨부만 있을 수 있다)."""
    s = body.strip()
    if s == PREFIX:
        return ""
    if s.startswith(PREFIX + " "):
        return s[len(PREFIX) :].strip()
    return None


def spawn(
    channel_id: uuid.UUID,
    asker_id: uuid.UUID,
    question: str,
    attachments: list[dict] | None,
) -> None:
    task = asyncio.create_task(reply(channel_id, asker_id, question, attachments or []))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def ai_user(db: AsyncSession) -> User:
    """시스템 계정 — 없으면 만든다(마이그레이션·seed 없이, 첫 커맨드 때). 첫 커맨드 둘이 겹쳐도 `ON CONFLICT DO NOTHING`
    뒤 다시 조회하므로 한쪽이 실패하지 않는다(리뷰). 그 이메일 계정이 활성이면(사람이 DB 를 손댄 경우) 사칭 위험이라 쓰지 않는다."""
    user = await db.scalar(select(User).where(User.email == AI_EMAIL))
    if user is None:
        # 비밀번호는 아무도 모르는 난수의 해시 — 「!」 같은 가짜 값은 로그인 경로에서 해시 판독 오류(500)를 낸다
        pw_hash = await hash_password_async(secrets.token_urlsafe(32))
        await db.execute(
            pg_insert(User)
            .values(name=AI_NAME, email=AI_EMAIL, pw_hash=pw_hash, role="member", active=False)
            .on_conflict_do_nothing(index_elements=[User.email])
        )
        user = await db.scalar(select(User).where(User.email == AI_EMAIL))
        assert user is not None
    if user.active:
        raise RuntimeError("AI 시스템 계정이 활성 상태다 — 사칭 위험, 답하지 않는다")
    return user


def is_bot(user: User) -> bool:
    return user.email == AI_EMAIL


_MD_RE = re.compile(r"[\[\]()!`<>]")


def _plain_title(title: str) -> str:
    """「근거:」 줄에 넣는 제목·파일명 — 줄바꿈과 마크다운 기호를 전각으로(채팅을 마크다운으로 그려도 링크·이미지가 안 되게)."""
    one = " ".join(title.split())
    return _MD_RE.sub(
        lambda m: {
            "[": "［",
            "]": "］",
            "(": "（",
            ")": "）",
            "!": "！",
            "`": "'",
            "<": "〈",
            ">": "〉",
        }[m.group()],
        one,
    )[:80]


async def _attachment_block(
    channel_id: uuid.UUID, attachments: list[dict], sources: list
) -> str | None:
    """메시지에 실린 채널 첨부(최대 3)를 51 의 추출기로 읽어 `<첨부>` 블록으로. 못 읽는 파일은 한 줄 알림."""
    from app.routers import ai as ai_router  # 순환 import 회피(ai_router 가 realtime 을 모른다)
    from app.routers.channels import attachment_key, parse_attachment_url

    if not attachments:
        return None
    lines: list[str] = []
    budget = settings.ai_doc_max_chars
    for a in attachments[:MAX_COMMAND_ATTACHMENTS]:
        parsed = parse_attachment_url(str(a.get("url", "")), channel_id)
        name = str(a.get("name") or "첨부")
        if parsed is None:
            continue
        file_id, key_name = parsed
        got = await storage.get(attachment_key(channel_id, file_id, key_name))
        if got is None:
            lines.append(f"(첨부를 찾지 못했다: 《{ai_router._body(name)}》)")
            continue
        try:
            async with (
                ai_router._extract_slots
            ):  # 업로드 경로와 같은 가드(동시 2건·60초, 보안 리뷰)
                text = await asyncio.wait_for(
                    asyncio.to_thread(extract.extract, key_name, got[0]),
                    ai_router.ATTACH_EXTRACT_TIMEOUT_S,
                )
        except TimeoutError:
            lines.append(f"(읽는 데 너무 오래 걸림: 《{ai_router._body(name)}》)")
            continue
        except extract.Unsupported:
            lines.append(f"(읽지 못하는 형식: 《{ai_router._body(name)}》)")
            continue
        except extract.Empty:
            lines.append(f"(읽을 글자가 없음: 《{ai_router._body(name)}》)")
            continue
        if budget <= 0:
            lines.append(f"(본문 한도를 다 써서 넣지 못했다: 《{ai_router._body(name)}》)")
            continue
        piece = text[:budget]
        budget -= len(piece)
        note = f"\n(본문이 길어 앞 {len(piece)}자만 넣었다)" if len(text) > len(piece) else ""
        n = len(sources) + 1
        sources.append(
            ai_router.Citation(
                n=n,
                type="file",
                to=str(a.get("url", "")),
                doc_id=None,
                title=name,
                quote=piece[:200],
                path="첨부",
            )
        )
        lines.append(f"[{n}] 《{ai_router._body(name)}》 {ai_router._body(piece)}{note}")
    return "<첨부>\n" + "\n\n".join(lines) + "\n</첨부>" if lines else None


async def reply(
    channel_id: uuid.UUID, asker_id: uuid.UUID, question: str, attachments: list[dict]
) -> None:
    """답을 만들어 채널에 AI 메시지로 단다. 실패하면 짧은 실패 메시지(원인은 로그에만)."""
    from app.routers import ai as ai_router

    try:
        async with _reply_slots, session_scope() as db:
            bot = await ai_user(db)
            asker = await db.get(User, asker_id)
            if asker is None:
                return
            if not question and not attachments:
                await post_message(
                    db, channel_id, bot, "질문을 적어 주세요. 예: `/ai 연차는 며칠이야`"
                )
                return
            sources: list = []
            rules_block = await ai_router._rules_sources(db, sources)
            audit.record(
                db,
                "ai.chat_command",
                actor_id=asker_id,
                target_id=channel_id,
                detail={"chars": len(question), "attachments": len(attachments or [])},
            )
            await (
                db.commit()
            )  # 감사 행 + 봇 계정 — 파일을 읽고 공급자를 기다리는 동안 커넥션을 쥐지 않는다
            attach_block = await _attachment_block(channel_id, attachments, sources)
            blocks: list[dict[str, object]] = [{"type": "text", "text": ai_router.SYSTEM_PROMPT}]
            if rules_block is not None:
                blocks.append(
                    {
                        "type": "text",
                        "text": ai_router.RULES_PROMPT + "\n" + rules_block,
                        "cache_control": {"type": "ephemeral"},
                    }
                )
            if attach_block is not None:
                blocks.append(
                    {"type": "text", "text": ai_router.ATTACH_PROMPT + "\n" + attach_block}
                )
            blocks.append(
                {
                    "type": "text",
                    "text": "이 질문은 채팅방에서 /ai 커맨드로 들어왔다. 채팅방의 다른 대화는 모른다 — 질문과 첨부만으로 답한다. "
                    "답은 채팅 메시지 한 개 분량으로 간결하게.",
                }
            )
            messages: list = [{"role": "user", "content": question or "첨부 파일을 요약해 줘"}]
            parts: list[str] = []
            last_round: list[str] = []
            async with asyncio.timeout(REPLY_TIMEOUT_S):
                async for kind, text in ai_router._turns(
                    get_provider(),
                    blocks,
                    messages,
                    asker,
                    sources,
                    None,
                    parts,
                    max_tokens=ai_router.CHECK_MAX_TOKENS,
                ):
                    if kind == "status":
                        last_round.clear()
                    elif kind == "token":
                        last_round.append(text)
            answer = "".join(last_round).strip()
            if not answer:
                raise LLMError("AI_EMPTY", "빈 답")
            cited = ai_router._cited(answer, sources)
            if cited:
                answer += "\n\n근거: " + " · ".join(
                    f"[{c.n}] {_plain_title(c.title)}" + ("" if c.type == "file" else f" {c.to}")
                    for c in cited
                )
            still_member = await db.scalar(
                select(ChannelMember.user_id).where(
                    ChannelMember.channel_id == channel_id, ChannelMember.user_id == asker_id
                )
            )
            if still_member is None:
                return  # 답을 기다리는 사이 채널에서 나갔다(강퇴 포함) — 조용히 끝낸다(리뷰)
            await post_message(db, channel_id, bot, answer)
    except Exception:  # noqa: BLE001 — 태스크라 잡지 않으면 조용히 사라진다. 원인은 로그에만
        log.exception("AI 채팅 커맨드 실패 channel=%s", channel_id)
        try:
            async with session_scope() as db:
                bot = await ai_user(db)
                await post_message(
                    db, channel_id, bot, "AI 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
                )
        except Exception:  # noqa: BLE001
            log.exception("AI 채팅 커맨드 실패 메시지도 못 보냄 channel=%s", channel_id)


async def post_message(db: AsyncSession, channel_id: uuid.UUID, author: User, body: str) -> None:
    """채널에 메시지 한 줄을 넣고 멤버에게 `msg`·`unread` 를 민다 — realtime.chat 의 msg 경로와 같은 모양(멘션·숨긴 DM
    복귀 제외). 봇은 멤버가 아니라 `last_read_at` 갱신이 없다."""
    from app.realtime import chat

    now = datetime.now(UTC)
    message = Message(channel_id=channel_id, author_id=author.id, body=body, created_at=now)
    db.add(message)
    await db.execute(
        update(ChannelMember)
        .where(ChannelMember.channel_id == channel_id, ChannelMember.hidden_at.is_not(None))
        .values(hidden_at=None)
    )
    await db.flush()
    await db.commit()
    members = await chat._members(db, channel_id)
    counts = await chat._unread_counts(db, channel_id)
    events = [
        (
            list(members),
            {
                "ev": "msg",
                "channel_id": channel_id,
                "message": {
                    "id": message.id,
                    "channel_id": channel_id,
                    "author": {
                        "id": author.id,
                        "name": author.name,
                        "is_bot": True,
                    },  # 이름이 아니라 이 칸으로 판별
                    "body": body,
                    "doc_ref": None,
                    "attachments": None,
                    "created_at": now,
                    "edited_at": None,
                },
            },
        ),
        *(
            ([uid], {"ev": "unread", "channel_id": channel_id, "count": c})
            for uid, c in counts.items()
        ),
    ]
    await asyncio.gather(*(chat.push(targets, event) for targets, event in events))
