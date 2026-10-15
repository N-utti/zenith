"""AI 열람 도구(README 56) — 근태·휴가·결재·자료실을 **질문자 권한 그대로** 읽는다(사용자 결정 2026-10-15).

도구마다 기존 라우터의 판정 함수·핸들러를 그대로 부른다(권한 규칙을 두 벌 두지 않는다): 근태는 attendance 의
`_days`·`_summary`·`_balance`·`_staff`·`list_leaves`(팀·전사는 team_grid 와 같은 조건), 결재는 approvals 의
`list_approvals`·`_can_view`·`_out`, 자료실은 archive 의 `list_archive`, 파일 본문은 채널 첨부(멤버 + 살아 있는 메시지에
실린 것)의 내려받기 판정과 같고 문서 파일은 자료실 목록과 같은 범위(살아 있는 문서에 붙은 것)다. 거부는 `acl.denied`
감사로 남긴다(HTTP 403 과 같은 결). 사람이 쓴 글(결재 본문·의견·제목·파일명·메모)은 `_body()` 로 표지를 무력화해
넣는다 — 각주 번호·블록 태그 위조를 막는다(보안 리뷰).

**결과를 보는 사람**: `/ai/chat` 은 질문자만 보지만 채팅 `/ai` 의 답은 채널 멤버 전원이 본다. 그래서 채팅에는 채널
멤버가 원래 받을 수 있는 자료실·파일 읽기(`CHANNEL_SAFE`)만 주고, 근태·결재는 주지 않는다(보안·코드 리뷰 HIGH).
결과는 번호 없는 평문 — 근거 카드·각주는 없다(ponytail: 결재 카드·근태 링크는 프론트가 원하면).
"""

import asyncio
import logging
import re
import uuid
from urllib.parse import unquote

from sqlalchemy import select

from app import audit, storage
from app.ai import extract
from app.config import settings
from app.db import session_scope
from app.errors import ApiError
from app.models import ChannelMember, Document, Message, StoredFile, Team, User

log = logging.getLogger(__name__)

ATTENDANCE_TOOL = {
    "name": "attendance",
    "description": (
        "근태·휴가를 본다. who=me 는 질문자의 그달 근무일·결근·지각·휴가·연장근로와 그해 연차 잔여. "
        "who=team 은 팀장(자기 팀)·임원만, who=company 는 임원만 — 사람마다 월 집계. "
        "month 는 YYYY-MM(비우면 이번 달)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "month": {"type": "string", "description": "YYYY-MM"},
            "who": {"type": "string", "enum": ["me", "team", "company"]},
        },
    },
}
APPROVALS_TOOL = {
    "name": "approvals",
    "description": (
        "결재 문서 목록. box=inbox 내가 처리할 것(결재선), sent 내가 올린 것, reference 참조로 받은 것, "
        "draft 내 임시저장. status 로 거를 수 있다(pending·approved·rejected·canceled·closed). 최근 20건."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "box": {"type": "string", "enum": ["inbox", "sent", "reference", "draft"]},
            "status": {"type": "string"},
        },
    },
}
APPROVAL_DETAIL_TOOL = {
    "name": "approval_detail",
    "description": "결재 문서 하나의 본문·금액·결재선 진행·의견. id 는 approvals 결과의 id. 열람 권한이 없으면 오류.",
    "input_schema": {
        "type": "object",
        "properties": {"id": {"type": "string"}},
        "required": ["id"],
    },
}
ARCHIVE_TOOL = {
    "name": "archive",
    "description": (
        "자료실 — 질문자가 받을 수 있는 채팅 첨부·문서 파일 목록(최근 순). query 로 파일명·출처를 거른다. "
        "본문이 필요하면 결과의 url 로 read_file."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
    },
}
READ_FILE_TOOL = {
    "name": "read_file",
    "description": (
        "자료실 파일의 본문을 읽는다(txt·md·csv·docx·xlsx·pdf·hwpx). url 은 archive 결과의 url 그대로. "
        "받을 권한이 없거나 읽을 수 없는 형식이면 오류."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"],
    },
}
TOOLS = [ATTENDANCE_TOOL, APPROVALS_TOOL, APPROVAL_DETAIL_TOOL, ARCHIVE_TOOL, READ_FILE_TOOL]
NAMES = frozenset(t["name"] for t in TOOLS)
# 채팅 /ai 에 주는 것 — 답이 채널 전원에게 보이므로 채널 멤버가 원래 받을 수 있는 자료만
CHANNEL_SAFE = frozenset({"archive", "read_file"})

LIST_MAX = 20
ARCHIVE_MAX = 50
_MONTH_RE = re.compile(r"^(19|20)\d{2}-(0[1-9]|1[0-2])$")
_CHANNEL_URL = re.compile(r"^/api/channels/([0-9a-f-]{36})/attachments/([0-9a-f-]{36})/([^/]+)$")
_FILE_URL = re.compile(r"^/api/files/([0-9a-f-]{36})$")


def _err(text: str) -> dict[str, object]:
    return {"content": text, "is_error": True}


def _ok(text: str) -> dict[str, object]:
    return {"content": text}


def _body(text: str) -> str:
    from app.routers import (
        ai as ai_router,  # 순환 import 회피(ai.py 가 이 모듈을 맨 위에서 가져온다)
    )

    return ai_router._body(text)


async def run(user: User, name: str, inp: dict, *, budget: int, via: str) -> dict[str, object]:
    """도구 하나를 질문자 권한으로 실행한다. 예외는 오류 문구로 — 도구 하나 때문에 답변이 죽지 않게.
    `budget` 은 이 답변에 남은 글자 예산(read_document 와 공유) — 결과를 그 안으로 자른다. `via` 는 감사용 경로."""
    fn = {
        "attendance": _attendance,
        "approvals": _approvals,
        "approval_detail": _approval_detail,
        "archive": _archive,
        "read_file": _read_file,
    }[name]
    if budget <= 0:
        return _err("이 답변의 자료 읽기 한도를 다 썼습니다.")
    try:
        async with session_scope() as db:
            result = await fn(db, user, inp if isinstance(inp, dict) else {}, via)
    except ApiError as e:
        return _err(e.detail)
    except Exception as e:  # noqa: BLE001
        log.exception("AI 열람 도구 실패 %s: %r", name, e)
        return _err("자료를 읽지 못했습니다. 잠시 뒤 다시 시도합니다.")
    content = str(result["content"])
    if len(content) > budget:
        result["content"] = content[:budget] + "\n(한도에 걸려 뒤를 잘랐다)"
    return result


async def _denied(
    db, user: User, tool: str, reason: str, via: str, target=None
) -> dict[str, object]:
    audit.record(
        db,
        "acl.denied",
        actor_id=user.id,
        target_id=target,
        detail={"path": f"ai.{tool}", "reason": reason, "via": via},
    )
    await db.commit()
    return _err("열람 권한이 없습니다.")


# ── 근태 ───────────────────────────────────────────────────────────────────────


def _minutes(m: int) -> str:
    return f"{m // 60}시간 {m % 60}분" if m else "0"


async def _attendance(db, user: User, inp: dict, via: str) -> dict[str, object]:
    from app.routers import approvals as ap
    from app.routers import attendance as att

    month = inp.get("month") or ap.today().strftime("%Y-%m")  # KST 기준 오늘(서버 시간대가 아니라)
    if not isinstance(month, str) or not _MONTH_RE.match(month):
        return _err("month 는 YYYY-MM 모양이어야 합니다.")
    who = inp.get("who") or "me"
    first, last = att._month_bounds(month)
    if who == "me":
        days = (await att._days(db, [user.id], first, last))[user.id]
        s = att._summary(days)
        year = first.year
        bal = att._balance(year, (await att._used(db, [user.id], year)).get(user.id, 0))
        # 상태(대기·승인·반려)는 결재 문서에서 오므로 핸들러(list_leaves)를 그대로 — 그달과 겹치는 것만
        mine = await att.list_leaves(scope="me", from_=None, to=None, user=user, db=db)
        leaves = [r for r in mine.items if r.start_date <= last and r.end_date >= first]
        lines = [
            f"{month} {user.name} 근태 — 근무 {s.worked_days}일, 휴가 {s.leave_days}일, "
            f"연장 {_minutes(s.overtime_minutes)}, 야간 {_minutes(s.night_minutes)}",
            f"{year}년 연차: 부여 {bal.granted}, 사용 {bal.used}, 잔여 {bal.remaining}, 소멸 {bal.expires_on}",
        ]
        odd = [d for d in days if d.status != "normal" or d.overtime_minutes or d.note]
        if odd:
            lines.append(
                "특이일: "
                + "; ".join(
                    f"{d.work_date} {d.status}"
                    + (f" 연장 {_minutes(d.overtime_minutes)}" if d.overtime_minutes else "")
                    + (f" ({_body(d.note)})" if d.note else "")
                    for d in odd
                )
            )
        if leaves:
            lines.append(
                "휴가 신청: "
                + "; ".join(
                    f"{r.type_code} {r.start_date}~{r.end_date} {r.days}일 {r.status}"
                    for r in leaves
                )
            )
        return _ok("\n".join(lines))
    if who not in ("team", "company"):
        return _err("who 는 me·team·company 중 하나입니다.")
    team_id = user.team_id if who == "team" else None
    team = await db.get(Team, team_id) if team_id is not None else None
    is_lead = team is not None and team.lead_id == user.id
    if user.role != "exec" and not (who == "team" and is_lead):
        return await _denied(db, user, "attendance", who, via, team_id)
    if who == "team" and team is None:
        return _err("소속 팀이 없습니다.")
    staff = await att._staff(db, team_id, (first, last))
    days = await att._days(db, [u.id for u, _ in staff], first, last)
    head = f"{month} {'전사' if team is None else _body(team.name)} 근태(사람 {len(staff)}명)"
    rows = []
    for u, t in staff:
        s = att._summary(days[u.id])
        absent = sum(1 for d in days[u.id] if d.status == "absent")
        rows.append(
            f"- {u.name}({_body(t.name) if t else '팀 없음'}): 근무 {s.worked_days}일, 휴가 {s.leave_days}일, "
            f"연장 {_minutes(s.overtime_minutes)}, 야간 {_minutes(s.night_minutes)}"
            + (f", 결근 {absent}일" if absent else "")
        )
    return _ok("\n".join([head, *rows]))


# ── 결재 ───────────────────────────────────────────────────────────────────────


def _person(p) -> str:
    return p.name if p is not None else "-"


async def _approvals(db, user: User, inp: dict, via: str) -> dict[str, object]:
    from app.routers import approvals as ap

    box = inp.get("box") or "inbox"
    if box not in ("inbox", "sent", "reference", "draft"):
        return _err("box 는 inbox·sent·reference·draft 중 하나입니다.")
    status = inp.get("status") or None
    if status is not None and status not in (
        "draft",
        "pending",
        "approved",
        "rejected",
        "canceled",
        "closed",
    ):
        return _err("status 가 올바르지 않습니다.")
    page = await ap.list_approvals(
        box=box, type=None, status=status, from_=None, to=None, drafter=None, user=user, db=db
    )
    items = page.items[:LIST_MAX]
    if not items:
        return _ok(f"{box} 함에 결재 문서가 없습니다.")
    lines = [f"{box} 함 결재 문서 {len(items)}건(최근 순):"]
    for i in items:
        when = (i.submitted_at or i.created_at).strftime("%Y-%m-%d")
        lines.append(
            f"- id={i.id} [{i.type_code}] {_body(i.title)} — {i.status}, 기안 {i.drafter.name}, {when}"
            + (f", 대기: {i.waiting_on.name}" if i.waiting_on else "")
            + (f", 금액 {i.amount:,}원" if i.amount is not None else "")
        )
    return _ok("\n".join(lines))


async def _approval_detail(db, user: User, inp: dict, via: str) -> dict[str, object]:
    from app.routers import approvals as ap

    try:
        doc_id = uuid.UUID(str(inp.get("id")))
    except ValueError:
        return _err("id 는 approvals 결과의 id 여야 합니다.")
    doc = await ap._get_doc(db, doc_id)  # 없으면 ApiError 404 → run 이 오류 문구로(HTTP 와 같다)
    steps = (await ap._steps_of(db, [doc.id]))[doc.id]
    if not await ap._can_view(db, user, doc, steps):
        return await _denied(db, user, "approval_detail", "view", via, doc.id)
    out = await ap._out(db, doc, user)
    lines = [
        f"[{out.type_code}] {_body(out.title)} — {out.status}, 기안 {out.drafter.name}, "
        f"상신 {out.submitted_at.strftime('%Y-%m-%d') if out.submitted_at else '-'}"
        + (f", 종결 {out.closed_at.strftime('%Y-%m-%d')}" if out.closed_at else ""),
    ]
    if out.amount is not None:
        lines.append(f"금액: {out.amount:,}원")
    body = (out.subject.body or "")[: settings.ai_doc_max_chars]
    if body:
        lines.append("본문:\n<결재 본문>\n" + _body(body) + "\n</결재 본문>")
    if out.subject.attachments:
        lines.append("첨부: " + ", ".join(_body(a.name) for a in out.subject.attachments))
    lines.append("결재선:")
    for s in out.steps:
        lines.append(
            f"  {s.step_no}. {_person(s.approver)} ({s.role}) — {s.status}"
            + (f", 처리 {_person(s.acted_by)}" if s.acted_by else "")
            + (f", {s.acted_at.strftime('%Y-%m-%d')}" if s.acted_at else "")
            + (f", 의견: {_body(s.comment)}" if s.comment else "")
        )
    return _ok("\n".join(lines))


# ── 자료실 ─────────────────────────────────────────────────────────────────────


async def _archive(db, user: User, inp: dict, via: str) -> dict[str, object]:
    from app.routers import archive as ar

    page = await ar.list_archive(limit=200, user=user, db=db)
    q = inp.get("query")
    q = q.strip().lower() if isinstance(q, str) else ""
    items = [f for f in page.items if not q or q in f.name.lower() or q in f.source_title.lower()][
        :ARCHIVE_MAX
    ]
    if not items:
        return _ok("자료실에 해당하는 파일이 없습니다.")
    lines = [f"자료실 파일 {len(items)}건(최근 순):"]
    for f in items:
        kind = "채팅" if f.source == "chat" else "문서"
        lines.append(
            f"- {_body(f.name)} ({f.size:,}바이트, {kind} 《{_body(f.source_title)}》, {f.uploaded_by.name}, "
            f"{f.created_at.strftime('%Y-%m-%d')}) url={f.url}"
        )
    return _ok("\n".join(lines))


async def _read_file(db, user: User, inp: dict, via: str) -> dict[str, object]:
    from app.routers import ai as ai_router
    from app.routers.channels import attachment_key, attachment_url

    url = inp.get("url")
    if not isinstance(url, str):
        return _err("url 은 archive 결과의 url 이어야 합니다.")
    try:
        if m := _CHANNEL_URL.fullmatch(url):
            channel_id, file_id = uuid.UUID(m.group(1)), uuid.UUID(m.group(2))
            name = unquote(m.group(3))
            # 채널 첨부 내려받기와 같은 판정 — 멤버이고, 이 채널의 살아 있는 메시지에 실린 파일만
            if await db.get(ChannelMember, (channel_id, user.id)) is None:
                return await _denied(db, user, "read_file", "member", via, channel_id)
            carried = await db.scalar(
                select(Message.id)
                .where(
                    Message.channel_id == channel_id,
                    Message.attachments.contains(
                        [{"url": attachment_url(channel_id, file_id, name)}]
                    ),
                )
                .limit(1)
            )
            if carried is None:
                return _err("없는 파일이거나 받을 수 없습니다.")
            key = attachment_key(channel_id, file_id, name)
        elif m := _FILE_URL.fullmatch(url):
            file_id = uuid.UUID(m.group(1))
            # 자료실 목록과 같은 범위 — 기록부에 있고 살아 있는 문서에 붙은 파일만(HTTP 보다 좁다, README 56)
            row = await db.get(StoredFile, file_id)
            alive = (
                row is not None
                and row.doc_id is not None
                and await db.scalar(
                    select(Document.id).where(
                        Document.id == row.doc_id, Document.deleted_at.is_(None)
                    )
                )
            )
            if not alive:
                return _err("없는 파일이거나 받을 수 없습니다.")
            name, key = row.name, f"files/{file_id}"
        else:
            return _err("url 은 archive 결과의 url 이어야 합니다.")
    except ValueError:
        return _err("url 은 archive 결과의 url 이어야 합니다.")
    found = await storage.get(key)
    if found is None:
        return _err("없는 파일이거나 받을 수 없습니다.")
    data, _content_type = found
    if len(data) > ai_router.ATTACH_MAX_BYTES:
        return _err("파일이 커서 읽을 수 없습니다.")
    try:
        async with ai_router._extract_slots:
            text = await asyncio.wait_for(
                asyncio.to_thread(extract.extract, name, data), ai_router.ATTACH_EXTRACT_TIMEOUT_S
            )
    except extract.Unsupported:
        return _err("읽을 수 없는 형식입니다(txt·md·csv·docx·xlsx·pdf·hwpx 만).")
    except extract.Empty:
        return _err("읽을 글자가 없는 파일입니다.")
    except TimeoutError:
        return _err("파일을 읽는 데 너무 오래 걸립니다.")
    full = text
    text = full[: settings.ai_doc_max_chars]
    note = f"\n(본문이 길어 앞 {len(text)}자만)" if len(full) > len(text) else ""
    return _ok(f"《{_body(name)}》 본문:\n<파일>\n{_body(text)}\n</파일>{note}")
