"""13-전자결재 §9 결재 엔진 API — README "설계와 어긋나는 것" 35. 근태 신청 4종의 승인도 여기로 온다(13 §7.1).

요청·응답 모양은 프론트 목(`frontend/src/mocks/approvalsDb.ts`, README 20)이 먼저 정한 그대로다.

- 권한은 역할이 아니라 **관계**로 판정한다(backend/CLAUDE.md): 열람 = 기안자 · 결재선의 사람(참조자는 상신 뒤에만) ·
  대신 처리한 사람 · 지금 차례를 위임받은 사람 · exec. 승인·반려 = 지금 차례인 사람 또는 그 사람이 위임한 사람.
  거부는 403 + 감사 `acl.denied`.
- 결재선은 상신할 때 서버가 만든다(13 §4.2.2): 기안자 팀의 팀장(`teams.lead_id`) → 활성 exec 전원(만든 순).
  근태 4종은 그 첫 사람 한 단계. 임원이 기안하면 결재선이 비어 바로 확정된다(13 TC-APV-04).
- 승인·반려는 단계의 `version` 이 맞을 때만(낙관 잠금) — 문서 행 잠금으로 직렬화한다.
- 알림: 차례가 온 사람에게 `apv_request`, 끝나면 기안자에게 `apv_approved|apv_rejected|apv_closed`.
"""

import asyncio
import logging
import uuid
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated, Literal, NoReturn
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import Date, cast, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, storage
from app.db import get_db
from app.deps import current_user, require_role
from app.errors import ApiError
from app.models import (
    ApprovalDelegation,
    ApprovalDocument,
    ApprovalStep,
    Notification,
    Team,
    User,
    WorkArrangement,
)
from app.prefs import wants
from app.realtime import chat
from app.routers.channels import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS,
    AttachmentOut,
    _normalize_content_type,
    attachment_response,
)

router = APIRouter(tags=["approvals"], dependencies=[Depends(current_user)])
require_exec = require_role("exec")
log = logging.getLogger("zenith.approvals")

# 날짜(위임 기간·근태 일자)는 한국 시각 기준 — UTC 로 재면 자정~오전 9시에 하루가 밀린다(목 주석과 같은 이유)
KST = timezone(timedelta(hours=9))  # ponytail: 고정 +9(한국은 서머타임 없음). tzdata 의존 없이


def today() -> date:
    return datetime.now(KST).date()


TypeCode = Literal["leave", "arrangement", "overtime", "correction", "general"]
DocStatus = Literal["draft", "pending", "approved", "rejected", "canceled", "closed"]
ATTENDANCE_TYPES = frozenset({"leave", "arrangement", "overtime", "correction"})
DECIDED = frozenset({"approved", "rejected", "delegated_done"})  # 누가 손댄 단계
LIST_MAX = (
    500  # ponytail: 결재함 상한. 15명 사내라 페이징 없이 — 넘으면 next_cursor 를 실제로 채운다
)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text2k = Annotated[str, StringConstraints(max_length=2000)]


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class ApprovalTypeOut(BaseModel):
    code: TypeCode
    name: str
    default_steps: int  # 기본 결재 단계 수
    # #158 B1: 전결·위임 플래그 분리는 결정 대기 — 프론트가 이 이름을 쓰고 있어 그대로 둔다
    allow_delegate_decision: bool


# 13 §4.1 approval_types 시드 — 표 대신 상수(양식 #158 A5 가 오면 표로)
APPROVAL_TYPES = [
    ApprovalTypeOut(code="leave", name="휴가", default_steps=1, allow_delegate_decision=True),
    ApprovalTypeOut(
        code="arrangement", name="예외 근무", default_steps=1, allow_delegate_decision=False
    ),
    ApprovalTypeOut(
        code="overtime", name="연장근로", default_steps=1, allow_delegate_decision=False
    ),
    ApprovalTypeOut(
        code="correction", name="근태 정정", default_steps=1, allow_delegate_decision=False
    ),
    ApprovalTypeOut(
        code="general", name="일반 기안", default_steps=2, allow_delegate_decision=True
    ),
]
TYPES = {t.code: t for t in APPROVAL_TYPES}


class Related(BaseModel):
    type: Literal["arrangement"]
    id: uuid.UUID


class Extra(BaseModel):
    """서식 칸의 값 — 서버는 뜻을 모르고 받은 그대로 돌려준다(프론트 templates.ts)."""

    form: str = Field(max_length=50)
    fields: dict[str, Annotated[str, StringConstraints(max_length=5000)]] = Field(max_length=50)


class Subject(BaseModel):
    """일반 기안 본문(13 §4.1 approval_forms). 근태 4종은 서버가 요약을 `body` 에 쓴다."""

    body: str = Field("", max_length=20_000)
    amount: int | None = Field(None, ge=0, le=10**13)  # 원
    related: Related | None = None
    attachments: list[AttachmentOut] | None = Field(None, max_length=MAX_ATTACHMENTS)
    extra: Extra | None = None


class StepOut(BaseModel):
    step_no: int
    approver: Person
    acted_by: Person | None  # 원 결재자가 아닌 사람이 처리했을 때 — 대결·강제 종결
    role: Literal["approve", "reference"]
    status: Literal["waiting", "approved", "rejected", "delegated_done", "skipped"]
    comment: str | None
    acted_at: datetime | None
    version: int


class ApprovalListItem(BaseModel):
    id: uuid.UUID
    type_code: TypeCode
    drafter: Person
    title: str
    status: DocStatus
    current_step: int | None  # 대기 중일 때만
    waiting_on: Person | None  # 지금 처리할 사람
    submitted_at: datetime | None
    created_at: datetime
    amount: int | None
    related: Related | None


class ApprovalOut(ApprovalListItem):
    subject: Subject
    steps: list[StepOut]
    closed_at: datetime | None
    can_decide: bool  # 지금 이 사람이 승인·반려할 수 있나 — 서버가 판정(위임 포함)


class ApprovalPage(BaseModel):
    items: list[ApprovalListItem]  # 상신(없으면 작성) 최근 순
    next_cursor: str | None


class DraftIn(BaseModel):
    type_code: Literal[
        "general"
    ]  # v1 은 일반 기안만 기안한다 — 근태 4종은 근태 화면의 신청이 문서가 된다
    title: Title
    subject: Subject
    # 참조자 id. PATCH 에서 생략(null)은 그대로, [] 는 전부 해제
    references: list[uuid.UUID] | None = Field(None, max_length=50)


class ApproveIn(BaseModel):
    version: int
    comment: Text2k | None = None


class RejectIn(BaseModel):
    version: int
    reason: Text2k | None = None


class ForceCloseIn(BaseModel):
    reason: Text2k | None = None


class DelegationOut(BaseModel):
    id: uuid.UUID
    delegate: Person
    start_date: date
    end_date: date
    type_code: TypeCode | None  # null = 모든 유형
    created_at: datetime


class DelegationIn(BaseModel):
    delegate_id: uuid.UUID
    start_date: date
    end_date: date
    type_code: str | None = None


class Items[T](BaseModel):
    items: list[T]


# ── 공통 ──────────────────────────────────────────────────────────────────


async def _steps_of(
    db: AsyncSession, doc_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ApprovalStep]]:
    out: dict[uuid.UUID, list[ApprovalStep]] = {i: [] for i in doc_ids}
    if doc_ids:
        rows = await db.scalars(
            select(ApprovalStep)
            .where(ApprovalStep.doc_id.in_(doc_ids))
            .order_by(ApprovalStep.step_no)
        )
        for s in rows:
            out[s.doc_id].append(s)
    return out


async def _people(db: AsyncSession, ids) -> dict[uuid.UUID, Person]:
    rows = await db.execute(select(User.id, User.name).where(User.id.in_(set(ids))))
    return {i: Person(id=i, name=n) for i, n in rows}


def _current(steps: list[ApprovalStep]) -> ApprovalStep | None:
    return next((s for s in steps if s.role == "approve" and s.status == "waiting"), None)


def _ids(doc: ApprovalDocument, steps: list[ApprovalStep]) -> list[uuid.UUID]:
    return [doc.drafter_id, *(s.approver_id for s in steps), *(s.acted_by_id for s in steps)]


def _item(doc: ApprovalDocument, steps: list[ApprovalStep], people) -> ApprovalListItem:
    cur = _current(steps) if doc.status == "pending" else None
    return ApprovalListItem(
        id=doc.id,
        type_code=doc.type_code,
        drafter=people[doc.drafter_id],
        title=doc.title,
        status=doc.status,
        current_step=cur.step_no if cur else None,
        waiting_on=people[cur.approver_id] if cur else None,
        submitted_at=doc.submitted_at,
        created_at=doc.created_at,
        amount=doc.amount,
        related=doc.subject.get("related"),
    )


async def _delegated(
    db: AsyncSession, owner_id: uuid.UUID, delegate_id: uuid.UUID, type_code: str
) -> bool:
    """오늘 owner → delegate 위임이 그 유형에 걸려 있나. **위임 불가 유형은 '모든 유형' 위임으로도 안 넘어간다.**"""
    if not TYPES[type_code].allow_delegate_decision:
        return False
    d = today()
    found = await db.scalar(
        select(ApprovalDelegation.id)
        .where(
            ApprovalDelegation.owner_id == owner_id,
            ApprovalDelegation.delegate_id == delegate_id,
            ApprovalDelegation.start_date <= d,
            ApprovalDelegation.end_date >= d,
            or_(ApprovalDelegation.type_code.is_(None), ApprovalDelegation.type_code == type_code),
        )
        .limit(1)
    )
    return found is not None


async def _acting(
    db: AsyncSession, user: User, doc: ApprovalDocument, steps: list[ApprovalStep]
) -> ApprovalStep | None:
    """지금 이 사람이 처리할 수 있는 단계 — 내 차례이거나, 차례인 사람이 나에게 위임했을 때.

    결재함(inbox)·열람·승인 처리가 이 판정 하나를 본다. 기안자는 위임으로도 자기 문서를 처리하지 못한다."""
    if doc.status != "pending":
        return None
    step = _current(steps)
    if step is None:
        return None
    if step.approver_id == user.id:
        return step
    if user.id != doc.drafter_id and await _delegated(db, step.approver_id, user.id, doc.type_code):
        return step
    return None


async def _can_view(
    db: AsyncSession, user: User, doc: ApprovalDocument, steps: list[ApprovalStep]
) -> bool:
    if doc.drafter_id == user.id or user.role == "exec":
        return True
    for s in steps:
        if s.acted_by_id == user.id:  # 대신 눌러 준 문서는 그 뒤에도 본다
            return True
        # 참조자는 상신 뒤에만 — 기안 때 고른 참조자가 steps 에 먼저 들어가 있다
        if s.approver_id == user.id and (s.role != "reference" or doc.status != "draft"):
            return True
    return await _acting(db, user, doc, steps) is not None


async def _deny(
    db: AsyncSession,
    request: Request,
    user: User,
    doc_id: uuid.UUID,
    why: str,
    code: str = "FORBIDDEN",
    message: str = "열람 권한이 없습니다.",
) -> NoReturn:
    audit.record(
        db,
        "acl.denied",
        request=request,
        actor_id=user.id,
        target_id=doc_id,
        detail={"path": request.url.path, "reason": why},
    )
    await db.commit()
    raise ApiError(403, code, message)


async def _get_doc(db: AsyncSession, doc_id: uuid.UUID, lock: bool = False) -> ApprovalDocument:
    doc = await db.get(ApprovalDocument, doc_id, with_for_update=lock, populate_existing=lock)
    if doc is None:
        raise ApiError(404, "NOT_FOUND", "문서를 찾을 수 없습니다.")
    return doc


async def _own_draft(
    db: AsyncSession, user: User, doc_id: uuid.UUID, lock: bool = True
) -> ApprovalDocument:
    """내 문서만 — 남의 것은 없는 것과 같은 404(목과 같다). 상태 확인은 부른 쪽이."""
    doc = await db.get(ApprovalDocument, doc_id, with_for_update=lock, populate_existing=lock)
    if doc is None or doc.drafter_id != user.id:
        raise ApiError(404, "NOT_FOUND", "문서를 찾을 수 없습니다.")
    return doc


async def _out(db: AsyncSession, doc: ApprovalDocument, viewer: User) -> ApprovalOut:
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    people = await _people(db, _ids(doc, steps))
    return ApprovalOut(
        **_item(doc, steps, people).model_dump(),
        subject=Subject.model_validate(doc.subject),
        steps=[
            StepOut(
                step_no=s.step_no,
                approver=people[s.approver_id],
                acted_by=people.get(s.acted_by_id) if s.acted_by_id else None,
                role=s.role,
                status=s.status,
                comment=s.comment,
                acted_at=s.acted_at,
                version=s.version,
            )
            for s in steps
        ],
        closed_at=doc.closed_at,
        can_decide=await _acting(db, viewer, doc, steps) is not None,
    )


async def _notify(
    db: AsyncSession,
    user_ids: list[uuid.UUID],
    kind: str,
    doc: ApprovalDocument,
    actor: User,
    now: datetime,
) -> list[Notification]:
    ids = [i for i in user_ids if i != actor.id]
    if not ids:
        return []
    rows = (
        await db.execute(
            select(User.id, User.preferences).where(User.id.in_(ids), User.active.is_(True))
        )
    ).all()
    notes = [
        Notification(
            user_id=uid,
            kind=kind,
            created_at=now,
            payload={
                "approval_id": str(doc.id),
                "type_code": doc.type_code,
                "title": doc.title,
                "from": {"id": str(actor.id), "name": actor.name},
            },
        )
        for uid, prefs in rows
        if wants(prefs, kind)
    ]
    db.add_all(notes)
    return notes


async def push(notes: list[Notification]) -> None:
    """commit 뒤에 — 열린 소켓으로 notice."""
    await asyncio.gather(*(chat.push_notice(n) for n in notes))


def _close(doc: ApprovalDocument, steps: list[ApprovalStep], status: str, now: datetime) -> None:
    """종료 상태로. 차례가 안 온 단계는 skipped(13 §6.2) — 대기로 남기면 끝난 문서가 진행 중처럼 보인다."""
    doc.status = status
    doc.closed_at = now
    for s in steps:
        if s.status == "waiting":
            s.status = "skipped"


async def _approvers(db: AsyncSession, drafter: User, type_code: str) -> list[uuid.UUID]:
    """13 §5.2 결재선. 팀장은 `teams.lead_id` 로만(README 18(b) — NULL 이면 팀장 없음), 그다음 활성 exec 전원.

    ponytail: 임원 순서는 계정을 만든 순 — 직급 칸이 없다. 회사 결재 규정(#158 A4·A5)이 오면 approval-policy 로.
    """
    if drafter.role == "exec":
        return []  # 임원 기안은 결재선이 없다 — 아랫사람에게 결재받지 않는다
    ids: list[uuid.UUID] = []
    if drafter.team_id is not None:
        lead = await db.scalar(
            select(User.id)
            .join(Team, Team.lead_id == User.id)
            .where(Team.id == drafter.team_id, User.active.is_(True))
        )
        if lead is not None:
            ids.append(lead)
    ids += (
        await db.scalars(
            select(User.id)
            .where(User.role == "exec", User.active.is_(True))
            .order_by(User.created_at, User.id)
        )
    ).all()
    ids = [i for i in dict.fromkeys(ids) if i != drafter.id]
    return ids if type_code == "general" else ids[:1]


def _ref_steps(doc_id: uuid.UUID, ids: list[uuid.UUID], start: int) -> list[ApprovalStep]:
    return [
        ApprovalStep(
            doc_id=doc_id,
            step_no=start + i,
            approver_id=uid,
            role="reference",
            status="skipped",  # 참조는 결재 차례가 아니다 — 대기 사슬에 넣지 않는다
            version=1,
        )
        for i, uid in enumerate(ids)
    ]


async def _submit(
    db: AsyncSession, doc: ApprovalDocument, drafter: User, now: datetime
) -> list[Notification]:
    """상신 — 결재선을 이 시점에 고정한다(13 §4.2.2). 기안 때 고른 참조자는 결재자 뒤에 붙는다."""
    old = (await _steps_of(db, [doc.id]))[doc.id]
    refs = [s.approver_id for s in old if s.role == "reference"]
    await db.execute(delete(ApprovalStep).where(ApprovalStep.doc_id == doc.id))
    approvers = await _approvers(db, drafter, doc.type_code)
    if not approvers and drafter.role != "exec":
        # 결재할 사람이 아무도 없다고 사원 문서를 자동 확정하면 안 된다 — 닫힌 쪽으로
        raise ApiError(422, "VALIDATION", "결재할 사람이 없습니다. 관리자에게 문의하세요.")
    taken = {drafter.id, *approvers}
    steps = [
        ApprovalStep(
            doc_id=doc.id,
            step_no=i + 1,
            approver_id=uid,
            role="approve",
            status="waiting",
            version=1,
        )
        for i, uid in enumerate(approvers)
    ] + _ref_steps(doc.id, [r for r in refs if r not in taken], len(approvers) + 1)
    db.add_all(steps)
    doc.submitted_at = now
    if not approvers:
        _close(doc, steps, "approved", now)  # 임원 기안: 즉시 확정, 문서와 이력은 남는다
        return []
    doc.status = "pending"
    return await _notify(db, [approvers[0]], "apv_request", doc, drafter, now)


# ── 근태(attendance.py)가 쓰는 입구 ─────────────────────────────────────────


async def start_request(
    db: AsyncSession, user: User, type_code: str, title: str, body: str, now: datetime
) -> tuple[ApprovalDocument, list[Notification]]:
    """근태 신청 한 건 = 상신된 결재 문서 한 건(13 §7.3). commit·push 는 부른 쪽이."""
    doc = ApprovalDocument(
        type_code=type_code,
        drafter_id=user.id,
        title=title,
        status="draft",
        subject={"body": body, "amount": None, "related": None},
        created_at=now,
    )
    db.add(doc)
    await db.flush()
    return doc, await _submit(db, doc, user, now)


async def cancel_request(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalDocument:
    """근태 신청의 승인 전 취소 — 문서를 회수한다. 누가 손댄 뒤면 409 REQUEST_DECIDED."""
    doc = await _get_doc(db, approval_id, lock=True)
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    if doc.status != "pending" or any(s.status in DECIDED for s in steps):
        raise ApiError(409, "REQUEST_DECIDED", "이미 처리된 신청은 취소할 수 없습니다.")
    _close(doc, steps, "canceled", datetime.now(UTC))
    return doc


# ── 위임 (13 §4.2.3) — `/approvals/{id}` 보다 먼저 등록해야 'delegations' 가 문서 id 로 잡히지 않는다 ──


@router.get(
    "/approval-types",
    response_model=Items[ApprovalTypeOut],
    summary="문서 유형 목록 + 유형별 기본 결재 단계 수",
)
async def list_types() -> Items[ApprovalTypeOut]:
    return Items(items=APPROVAL_TYPES)


async def _delegation_out(db: AsyncSession, rows: list[ApprovalDelegation]) -> list[DelegationOut]:
    people = await _people(db, [r.delegate_id for r in rows])
    return [
        DelegationOut(
            id=r.id,
            delegate=people[r.delegate_id],
            start_date=r.start_date,
            end_date=r.end_date,
            type_code=r.type_code,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get(
    "/approvals/delegations",
    response_model=Items[DelegationOut],
    summary="내가 건 위임 — 지금 유효한 것 먼저, 그다음 시작일 최근 순",
)
async def list_delegations(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[DelegationOut]:
    rows = list(
        await db.scalars(
            select(ApprovalDelegation)
            .where(ApprovalDelegation.owner_id == user.id)
            .order_by(ApprovalDelegation.start_date.desc())
        )
    )
    d = today()
    rows.sort(key=lambda r: not (r.start_date <= d <= r.end_date))  # 안정 정렬 — 시작일 순서 유지
    return Items(items=await _delegation_out(db, rows))


@router.post(
    "/approvals/delegations",
    status_code=201,
    response_model=DelegationOut,
    summary="위임 설정 — 자기 자신·거꾸로 된 기간·없는 사람 422, 위임 불가 유형 422 DELEGATE_NOT_ALLOWED, 겹침 409",
)
async def create_delegation(
    body: DelegationIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> DelegationOut:
    delegate = await db.get(User, body.delegate_id)
    if delegate is None or not delegate.active:
        raise ApiError(422, "VALIDATION", "없는 사람입니다.")
    if delegate.id == user.id:
        raise ApiError(422, "VALIDATION", "자기 자신에게는 위임할 수 없습니다.")
    if body.start_date > body.end_date:
        raise ApiError(422, "VALIDATION", "기간이 올바르지 않습니다.")
    if body.type_code is not None:
        known = TYPES.get(body.type_code)
        if known is None:
            raise ApiError(422, "VALIDATION", "없는 문서 유형입니다.")
        if not known.allow_delegate_decision:
            raise ApiError(
                422, "DELEGATE_NOT_ALLOWED", f"{known.name} 은 위임할 수 없는 유형입니다."
            )
    # 겹침 검사와 넣기 사이 경합 — 사람마다 직렬화(트랜잭션 자문 잠금)
    await db.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(f"delegation:{user.id}", 0)))
    )
    overlap = await db.scalar(
        select(ApprovalDelegation.id)
        .where(
            ApprovalDelegation.owner_id == user.id,
            ApprovalDelegation.start_date <= body.end_date,
            ApprovalDelegation.end_date >= body.start_date,
            # '모든 유형' 위임은 그 기간을 독점한다(#158 B4 기본안)
            or_(
                ApprovalDelegation.type_code.is_(None),
                body.type_code is None,
                ApprovalDelegation.type_code == body.type_code,
            ),
        )
        .limit(1)
    )
    if overlap is not None:
        raise ApiError(409, "DELEGATION_OVERLAP", "기간이 겹치는 위임이 이미 있습니다.")
    row = ApprovalDelegation(
        owner_id=user.id,
        delegate_id=delegate.id,
        start_date=body.start_date,
        end_date=body.end_date,
        type_code=body.type_code,
        created_at=datetime.now(UTC),
    )
    db.add(row)
    await db.flush()
    # 결재 권한을 남에게 넘기는 일이라 남긴다
    audit.record(
        db,
        "approvals.delegation_created",
        request=request,
        actor_id=user.id,
        target_id=row.id,
        detail={
            "delegate_id": str(delegate.id),
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat(),
            "type_code": body.type_code,
        },
    )
    await db.commit()
    return (await _delegation_out(db, [row]))[0]


@router.delete(
    "/approvals/delegations/{id}", status_code=204, summary="위임 해제 — 내 것만(남의 것 404)"
)
async def delete_delegation(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(ApprovalDelegation, id)
    if row is None or row.owner_id != user.id:
        raise ApiError(404, "NOT_FOUND", "위임을 찾을 수 없습니다.")
    await db.delete(row)
    audit.record(
        db,
        "approvals.delegation_deleted",
        request=request,
        actor_id=user.id,
        target_id=id,
        detail={"delegate_id": str(row.delegate_id)},
    )
    await db.commit()
    return Response(status_code=204)


# ── 기안 (13 §9.1) ────────────────────────────────────────────────────────


def attachment_url(doc_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"/api/approvals/{doc_id}/attachments/{file_id}/{quote(name, safe='')}"


def _attachment_key(doc_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"approvals/{doc_id}/{file_id}/{name}"


def _own_upload(doc_id: uuid.UUID, url: str) -> bool:
    """이 문서 경로로 서버가 발급한 url 모양인가. 저장 키에 문서 id 가 들어 있어 남의 파일 id 를 끼워도 받지 못한다."""
    prefix = f"/api/approvals/{doc_id}/attachments/"
    rest = url[len(prefix) :].split("/") if url.startswith(prefix) else []
    if len(rest) != 2 or not rest[1]:
        return False
    try:
        uuid.UUID(rest[0])
    except ValueError:
        return False
    return True


async def _check(db: AsyncSession, user: User, body: DraftIn, doc_id: uuid.UUID | None) -> None:
    """생성·수정이 같은 검증을 탄다."""
    files = body.subject.attachments or []
    # 새로 만들 때는 문서 id 가 없어 올린 파일도 없다 — 빈 목록만
    if any(doc_id is None or not _own_upload(doc_id, f.url) for f in files):
        raise ApiError(422, "VALIDATION", "이 문서에 올린 파일만 붙일 수 있습니다.")
    related = body.subject.related
    if related is not None:
        owner = await db.scalar(
            select(WorkArrangement.user_id).where(WorkArrangement.id == related.id)
        )
        if owner != user.id:
            raise ApiError(422, "VALIDATION", "내 출장에만 걸 수 있습니다.")
    refs = body.references
    if refs is not None:
        # 없는 사람을 조용히 버리면 프론트는 서버가 뺀 줄을 모른다. 겹친 id 도 줄을 두 개 만든다.
        if len(set(refs)) != len(refs):
            raise ApiError(422, "VALIDATION", "참조자가 겹칩니다.")
        found = await db.scalar(
            select(func.count()).select_from(User).where(User.id.in_(refs), User.active.is_(True))
        )
        if found != len(refs):
            raise ApiError(422, "VALIDATION", "없는 사람을 참조로 걸 수 없습니다.")


def _subject_json(subject: Subject) -> dict:
    data = subject.model_dump(mode="json")
    for key in ("attachments", "extra"):  # 안 보낸 칸은 저장하지 않는다(목과 같은 모양)
        if data[key] is None:
            del data[key]
    return data


@router.post(
    "/approvals/drafts",
    status_code=201,
    response_model=ApprovalOut,
    summary="{type_code: general, title, subject, references?} 임시저장. 첨부는 저장 뒤 그 문서에 올린다",
)
async def create_draft(
    body: DraftIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ApprovalOut:
    await _check(db, user, body, None)
    doc = ApprovalDocument(
        type_code=body.type_code,
        drafter_id=user.id,
        title=body.title,
        status="draft",
        subject=_subject_json(body.subject),
        amount=body.subject.amount,
        created_at=datetime.now(UTC),
    )
    db.add(doc)
    await db.flush()
    db.add_all(_ref_steps(doc.id, body.references or [], 1))
    await db.commit()
    return await _out(db, doc, user)


@router.patch(
    "/approvals/drafts/{id}",
    response_model=ApprovalOut,
    summary="임시저장 수정 — 내 것만(404), 상신한 문서 409 NOT_DRAFT. references 생략은 그대로, [] 는 전부 해제",
)
async def update_draft(
    id: uuid.UUID,
    body: DraftIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    doc = await _own_draft(db, user, id)
    if doc.status != "draft":
        raise ApiError(409, "NOT_DRAFT", "상신한 문서는 고칠 수 없습니다.")
    await _check(db, user, body, doc.id)
    doc.title = body.title
    doc.subject = _subject_json(body.subject)
    doc.amount = body.subject.amount
    if body.references is not None:
        await db.execute(delete(ApprovalStep).where(ApprovalStep.doc_id == doc.id))
        db.add_all(_ref_steps(doc.id, body.references, 1))
    await db.commit()
    return await _out(db, doc, user)


@router.delete(
    "/approvals/drafts/{id}",
    status_code=204,
    summary="임시저장 지우기(#281) — 내 것만(404), 상신한 적 있으면 409 NOT_DRAFT. 첨부도 같이, 감사 없음",
)
async def delete_draft(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    doc = await _own_draft(db, user, id)
    if doc.status != "draft":
        raise ApiError(409, "NOT_DRAFT", "상신한 문서는 지울 수 없습니다.")
    had_files = bool(doc.subject.get("attachments"))
    await db.execute(delete(ApprovalStep).where(ApprovalStep.doc_id == doc.id))
    await db.delete(doc)
    await db.commit()
    if had_files:
        # 문서는 이미 지웠다 — 저장소가 잠깐 안 되면 오브젝트만 남는다(채팅 첨부와 같은 한계)
        # ponytail: 올렸지만 저장하지 않은 파일은 여기서 안 지운다. 미참조 정리 배치가 생기면 거기서
        try:
            await storage.remove_prefix(f"approvals/{id}/")
        except ApiError:
            log.warning("결재 임시저장 %s 의 첨부를 지우지 못했다", id)
    return Response(status_code=204)


# ── 조회 (13 §9.3) ────────────────────────────────────────────────────────


@router.get(
    "/approvals",
    response_model=ApprovalPage,
    summary="결재함 ?box=inbox|sent|reference|draft · ?type=&status=&from=&to=&drafter= 필터",
)
async def list_approvals(
    box: Literal["inbox", "sent", "reference", "draft"] = "inbox",
    type: TypeCode | None = None,
    status: DocStatus | None = None,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    drafter: uuid.UUID | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ApprovalPage:
    D = ApprovalDocument
    at = func.coalesce(D.submitted_at, D.created_at)
    stmt = select(D).order_by(at.desc(), D.id.desc()).limit(LIST_MAX)
    owners: dict[uuid.UUID, list[str | None]] = {}
    if box == "draft":
        stmt = stmt.where(D.drafter_id == user.id, D.status == "draft")
    elif box == "sent":
        stmt = stmt.where(D.drafter_id == user.id, D.status != "draft")
    elif box == "reference":
        stmt = stmt.where(
            D.status != "draft",
            exists().where(
                ApprovalStep.doc_id == D.id,
                ApprovalStep.role == "reference",
                ApprovalStep.approver_id == user.id,
            ),
        )
    else:  # inbox — 내 차례 + 오늘 나에게 위임한 사람의 차례(아래에서 정확히 거른다)
        d = today()
        for owner_id, type_code in await db.execute(
            select(ApprovalDelegation.owner_id, ApprovalDelegation.type_code).where(
                ApprovalDelegation.delegate_id == user.id,
                ApprovalDelegation.start_date <= d,
                ApprovalDelegation.end_date >= d,
            )
        ):
            owners.setdefault(owner_id, []).append(type_code)
        stmt = stmt.where(
            D.status == "pending",
            D.id.in_(
                select(ApprovalStep.doc_id).where(
                    ApprovalStep.role == "approve",
                    ApprovalStep.status == "waiting",
                    ApprovalStep.approver_id.in_([user.id, *owners]),
                )
            ),
        )
    if type is not None:
        stmt = stmt.where(D.type_code == type)
    if status is not None:
        stmt = stmt.where(D.status == status)
    if drafter is not None:
        stmt = stmt.where(D.drafter_id == drafter)
    day = cast(func.timezone("Asia/Seoul", at), Date)
    if from_ is not None:
        stmt = stmt.where(day >= from_)
    if to is not None:
        stmt = stmt.where(day <= to)
    docs = list(await db.scalars(stmt))
    steps = await _steps_of(db, [d.id for d in docs])

    def mine(doc: ApprovalDocument) -> bool:
        cur = _current(steps[doc.id])
        if cur is None:
            return False
        if cur.approver_id == user.id:
            return True
        types = owners.get(cur.approver_id, [])
        return (
            doc.drafter_id != user.id
            and TYPES[doc.type_code].allow_delegate_decision
            and (None in types or doc.type_code in types)
        )

    if box == "inbox":
        docs = [d for d in docs if mine(d)]
    people = await _people(db, [i for d in docs for i in _ids(d, steps[d.id])])
    return ApprovalPage(items=[_item(d, steps[d.id], people) for d in docs], next_cursor=None)


@router.get(
    "/approvals/{id}",
    response_model=ApprovalOut,
    summary="문서 상세 + 결재선 진행 + 의견 이력. 열람은 기안자·결재선·참조자(상신 뒤)·대결자·exec, 그 밖 403",
)
async def get_approval(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    doc = await _get_doc(db, id)
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    if not await _can_view(db, user, doc, steps):
        await _deny(db, request, user, doc.id, "view")
    return await _out(db, doc, user)


# ── 처리 (13 §9.1·§9.2) ──────────────────────────────────────────────────


@router.post(
    "/approvals/{id}/submit",
    response_model=ApprovalOut,
    summary="상신 → pending(결재선 고정). 내 임시저장만(404), 이미 상신 409 NOT_DRAFT, 본문 없음 422",
)
async def submit(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ApprovalOut:
    doc = await _own_draft(db, user, id)
    if doc.status != "draft":
        raise ApiError(409, "NOT_DRAFT", "이미 상신한 문서입니다.")
    if not str(doc.subject.get("body", "")).strip():
        raise ApiError(422, "VALIDATION", "본문을 입력해 주세요.")
    notes = await _submit(db, doc, user, datetime.now(UTC))
    await db.commit()
    await push(notes)
    return await _out(db, doc, user)


@router.post(
    "/approvals/{id}/cancel",
    response_model=ApprovalOut,
    summary="회수 — 기안자만(404). 대기 중이 아니면 409 NOT_PENDING, 처리된 단계가 있으면 409 STEP_APPROVED",
)
async def cancel(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ApprovalOut:
    doc = await _own_draft(db, user, id)
    if doc.status != "pending":
        raise ApiError(409, "NOT_PENDING", "대기 중인 문서만 회수할 수 있습니다.")
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    # 대결 승인(delegated_done)도 센다 — 남이 대신 승인해 준 결재를 기안자가 조용히 거두지 못하게
    if any(s.status in DECIDED for s in steps):
        raise ApiError(
            409, "STEP_APPROVED", "이미 승인된 단계가 있어 회수할 수 없습니다. 반려를 요청하세요."
        )
    _close(doc, steps, "canceled", datetime.now(UTC))
    await db.commit()
    return await _out(db, doc, user)


async def _decide(
    db: AsyncSession,
    request: Request,
    user: User,
    id: uuid.UUID,
    approve: bool,
    version: int,
    text: str | None,
) -> ApprovalOut:
    doc = await _get_doc(db, id, lock=True)  # 두 탭이 동시에 눌러도 한 번만
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    step = await _acting(db, user, doc, steps)
    if step is None:
        await _deny(
            db, request, user, doc.id, "not_your_turn", "NOT_YOUR_TURN", "처리할 차례가 아닙니다."
        )
    if step.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "문서가 그새 바뀌었습니다. 새로고침해 주세요.")
    text = (text or "").strip() or None
    if not approve and text is None:
        raise ApiError(400, "REASON_REQUIRED", "반려 사유를 입력해 주세요.")
    if approve and doc.type_code in ATTENDANCE_TYPES:
        # 마감된 달의 근태를 승인으로 바꾸지 않는다(10 §5.5) — 해제하거나 반려한다
        from app.routers import attendance  # 순환 import 회피 — attendance 가 이 모듈을 쓴다

        if await attendance.request_in_closed_month(db, doc.id):
            raise ApiError(
                409, "MONTH_CLOSED", "마감된 달의 신청입니다. 승인하려면 마감을 해제해야 합니다."
            )
    now = datetime.now(UTC)
    delegated = step.approver_id != user.id
    step.comment = text
    step.acted_at = now
    step.version += 1
    if delegated:
        step.acted_by_id = user.id  # 원 결재자 이름은 단계에 그대로, 실제 처리자만 붙는다
    drafter = [doc.drafter_id]
    if not approve:
        step.status = "rejected"
        _close(doc, steps, "rejected", now)
        notes = await _notify(db, drafter, "apv_rejected", doc, user, now)
    else:
        step.status = "delegated_done" if delegated else "approved"
        nxt = _current(steps)
        if nxt is not None:
            notes = await _notify(db, [nxt.approver_id], "apv_request", doc, user, now)
        else:
            _close(doc, steps, "approved", now)
            notes = await _notify(db, drafter, "apv_approved", doc, user, now)
    await db.commit()
    await push(notes)
    return await _out(db, doc, user)


@router.post(
    "/approvals/{id}/approve",
    response_model=ApprovalOut,
    summary="{version, comment?} → 다음 단계 또는 확정. 차례 아님 403 NOT_YOUR_TURN, version 불일치 409",
)
async def approve(
    id: uuid.UUID,
    body: ApproveIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    return await _decide(db, request, user, id, True, body.version, body.comment)


@router.post(
    "/approvals/{id}/reject",
    response_model=ApprovalOut,
    summary="{reason, version} — 사유 없으면 400 REASON_REQUIRED. 반려되면 뒤 단계는 skipped",
)
async def reject(
    id: uuid.UUID,
    body: RejectIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    return await _decide(db, request, user, id, False, body.version, body.reason)


@router.post(
    "/approvals/{id}/force-close",
    response_model=ApprovalOut,
    summary="{reason} exec 강제 종결 → closed. 대기 중만(409 NOT_PENDING), 사유 없으면 400. 감사 approvals.force_closed",
)
async def force_close(
    id: uuid.UUID,
    body: ForceCloseIn,
    request: Request,
    user: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    doc = await _get_doc(db, id, lock=True)
    if doc.status != "pending":
        raise ApiError(409, "NOT_PENDING", "대기 중인 문서만 강제 종결할 수 있습니다.")
    reason = (body.reason or "").strip()
    if not reason:
        raise ApiError(400, "REASON_REQUIRED", "종결 사유를 입력해 주세요.")
    now = datetime.now(UTC)
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    step = _current(steps)
    if step is not None:
        # 사유는 걸려 있던 단계에 — "누구 차례에서 왜 끊겼나" 를 결재선 이력에서 읽는다
        step.comment = reason
        step.acted_by_id = user.id
        step.acted_at = now
    _close(doc, steps, "closed", now)
    audit.record(
        db,
        "approvals.force_closed",
        request=request,
        actor_id=user.id,
        target_id=doc.id,
        detail={"reason": reason, "step_no": step.step_no if step else None},
    )
    notes = await _notify(db, [doc.drafter_id], "apv_closed", doc, user, now)
    await db.commit()
    await push(notes)
    return await _out(db, doc, user)


# ── 첨부 (13 FR-APV-05) — 채팅 첨부와 같은 규약, 열람은 문서 열람 판정 ────────────


@router.post(
    "/approvals/{id}/attachments",
    status_code=201,
    response_model=AttachmentOut,
    summary="multipart `file` → MinIO. 내 임시저장만(404·상신 뒤 409 NOT_DRAFT). 받은 값을 subject.attachments 에 넣어 저장해야 붙는다",
)
async def upload_attachment(
    id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> AttachmentOut:
    # 잠그지 않는다 — 업로드 동안 행 잠금을 쥐지 않게. 그사이 상신되면 그 파일은 문서에 못 붙는다(저장이 409)
    doc = await _own_draft(db, user, id, lock=False)
    if doc.status != "draft":
        raise ApiError(409, "NOT_DRAFT", "상신한 문서에는 붙일 수 없습니다.")
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, "VALIDATION", "10MB 이하 파일만 올릴 수 있습니다.")
    if not data:
        raise ApiError(422, "VALIDATION", "빈 파일입니다.")
    name = storage.safe_name(file.filename)
    file_id = uuid.uuid4()
    content_type = _normalize_content_type(file.content_type)
    await storage.put(_attachment_key(id, file_id, name), data, content_type)
    return AttachmentOut(
        url=attachment_url(id, file_id, name), name=name, size=len(data), content_type=content_type
    )


@router.get(
    "/approvals/{id}/attachments/{file_id}/{name}",
    summary="결재 첨부 내려받기 — 문서를 열 수 있는 사람만(403), 문서에 붙어 있는 파일만(404)",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def download_attachment(
    id: uuid.UUID,
    file_id: uuid.UUID,
    name: str,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc = await _get_doc(db, id)
    steps = (await _steps_of(db, [doc.id]))[doc.id]
    if not await _can_view(db, user, doc, steps):
        await _deny(db, request, user, doc.id, "attachment")
    url = attachment_url(id, file_id, name)
    # 올렸다가 뗀 파일은 없는 것 — 문서를 볼 수 있어도 지금 붙어 있는 것만 내준다
    if not any(
        unquote(a.get("url", "")) == unquote(url) for a in doc.subject.get("attachments") or []
    ):
        raise ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.")
    found = await storage.get(_attachment_key(id, file_id, name))
    if found is None:
        raise ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.")
    return attachment_response(*found, name)
