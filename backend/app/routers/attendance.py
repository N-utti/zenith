"""04-API §10 근태(ATT) — README "설계와 어긋나는 것" 36. 모양은 프론트 목(`mocks/attendanceDb·leavesDb·closingsDb`).

출퇴근 기록(check-in/out, sync, import, identities, recompute)은 10-근태 v0.3 P3로 폐기됐고,
`/attendance/approvals*` 는 13-전자결재 §7.1로 폐기돼 `/approvals` 계열(approvals.py)이 대신한다.

- 신청 4종(휴가·예외 근무·연장근로·정정)은 만들 때 결재 문서 한 건으로 상신된다. 신청의 상태는 그 문서의 상태다
  (pending·approved·rejected·canceled, 강제 종결 closed 는 rejected 로 보인다).
- 근무 달력은 표가 없다: 근무일 = 주말·`holidays` 를 뺀 날, 필요할 때 센다(10 §4.2.2 의 att_days 대신).
  일자 상태(10 §5.2)는 승인된 휴가 > 반차 > 예외 근무 > 정상, 그 위에 승인된 정정이 덮는다. 연장은 더한다.
- 마감된 달(att_closings)에는 신청할 수 없다(409 MONTH_CLOSED, TC-ATT-16). 승인도 막는다(approvals._decide).
"""

import csv
import io
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import get_db
from app.deps import current_user, require_role
from app.errors import ApiError
from app.models import (
    ApprovalDocument,
    AttClosing,
    AttCorrection,
    AuditEvent,
    Holiday,
    LeaveRequest,
    OvertimeRequest,
    Team,
    User,
    WorkArrangement,
)
from app.routers import approvals
from app.routers.approvals import Person, today

router = APIRouter(tags=["attendance"], dependencies=[Depends(current_user)])
require_exec = require_role("exec")

RANGE_MAX_DAYS = 366  # 기간 조회·신청 상한(목과 같다)
# 신청 상태 = 결재 문서 상태. 강제 종결은 승인되지 않은 채 끝난 것이라 반려로 보인다(프론트 상태는 넷뿐)
REQUEST_STATUS = {
    "pending": "pending",
    "approved": "approved",
    "rejected": "rejected",
    "canceled": "canceled",
    "closed": "rejected",
}

MonthStr = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Clock = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
RequestStatus = Literal["pending", "approved", "rejected", "canceled"]
AttendanceStatus = Literal[
    "normal", "leave", "half_leave", "remote", "field", "trip", "holiday", "absent"
]
ArrangementKind = Literal["remote", "field", "trip"]


class LeaveTypeOut(BaseModel):
    code: str
    name: str
    paid: bool
    deduct_days: float  # 연차 차감 일수 0 | 0.5 | 1
    unit: Literal["day", "half"]  # half = 반차(하루짜리)


# 10 §4.1 leave_types 시드 — 표 대신 상수. 무급(unpaid)은 직원이 고르는 항목이 아니라 뺐다(2026-09-08 결정, 목과 같음)
LEAVE_TYPES = [
    LeaveTypeOut(code="annual", name="연차", paid=True, deduct_days=1, unit="day"),
    LeaveTypeOut(code="half_am", name="오전 반차", paid=True, deduct_days=0.5, unit="half"),
    LeaveTypeOut(code="half_pm", name="오후 반차", paid=True, deduct_days=0.5, unit="half"),
    LeaveTypeOut(code="sick", name="병가", paid=True, deduct_days=0, unit="day"),
    LeaveTypeOut(code="family", name="경조사", paid=True, deduct_days=0, unit="day"),
    LeaveTypeOut(code="official", name="공가", paid=True, deduct_days=0, unit="day"),
]
LEAVE_BY_CODE = {t.code: t for t in LEAVE_TYPES}
# ponytail: #158 A1(부여 기준) 결정 대기 — 기본안대로 1/1 일괄 15일. 입사일 기준·1년 미만 월할은 결정 나면 여기 한 함수
GRANTED_DAYS = 15
ARRANGEMENT_NAME = {"remote": "재택", "field": "외근", "trip": "출장"}
WORKED = {  # 정정으로 상태를 바꾸면 근무 환산일도 따라간다
    "normal": 1,
    "remote": 1,
    "field": 1,
    "trip": 1,
    "half_leave": 0.5,
    "leave": 0,
    "holiday": 0,
    "absent": 0,
}


class LeaveOut(BaseModel):
    id: uuid.UUID
    type_code: str
    start_date: date
    end_date: date
    days: float  # 서버가 산출한 차감 일수
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class LeaveOnCalendar(BaseModel):
    id: uuid.UUID
    user: Person
    type_code: str
    start_date: date
    end_date: date


class LeaveIn(BaseModel):
    type_code: str
    start_date: date
    end_date: date | None = None  # 반차는 무시(시작일 하루)
    reason: str | None = Field(
        None, max_length=500
    )  # 연차·반차는 없어도 된다, 차감 없는 휴가만 필수


class LeaveBalanceOut(BaseModel):
    year: int
    granted: float
    used: float  # 승인 + 대기(같은 연차를 두 번 신청하지 못하게)
    remaining: float
    expires_on: date
    grant_basis: Literal["hire_date", "fiscal_year"]


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str


class UserBrief(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    team: TeamOut | None


class LeaveBalanceRow(LeaveBalanceOut):
    user: UserBrief


class ArrangementOut(BaseModel):
    id: uuid.UUID
    kind: ArrangementKind
    start_date: date
    end_date: date
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class ArrangementOnCalendar(BaseModel):
    id: uuid.UUID
    user: Person
    kind: ArrangementKind
    start_date: date
    end_date: date


class ArrangementIn(BaseModel):
    kind: ArrangementKind
    start_date: date
    end_date: date
    reason: Reason


class OvertimeOut(BaseModel):
    id: uuid.UUID
    work_date: date
    start_time: str
    end_time: str  # 시작보다 이르면 자정을 넘긴 것
    minutes: int
    night_minutes: int
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class OvertimeIn(BaseModel):
    work_date: date
    start_time: Clock
    end_time: Clock
    reason: Reason


class OvertimeSum(BaseModel):
    minutes: int
    night_minutes: int


class OvertimePage(BaseModel):
    items: list[OvertimeOut]
    summary: OvertimeSum  # 승인분만(10 §5.3)


class CorrectionAfter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AttendanceStatus | None = None
    note: str | None = Field(None, max_length=200)


class CorrectionOut(BaseModel):
    id: uuid.UUID
    work_date: date
    after: CorrectionAfter
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class CorrectionIn(BaseModel):
    work_date: date
    after: CorrectionAfter
    reason: Reason


class DayOut(BaseModel):
    """근무일 한 행. 주말·휴일은 행이 없고, 휴일에 승인된 연장근로가 있는 날만 day_kind 가 workday 가 아닌 행이 생긴다."""

    work_date: date
    day_kind: Literal["workday", "weekly_holiday", "public_holiday", "company_holiday"]
    status: AttendanceStatus
    worked_days: float  # 1 | 0.5 | 0
    overtime_minutes: int
    night_minutes: int
    note: str | None


class Summary(BaseModel):
    worked_days: float  # 지난 날만 센다 — 1일에 열어도 "근무 22일" 이 뜨지 않게
    leave_days: float
    overtime_minutes: int
    night_minutes: int


class MonthOut(BaseModel):
    month: str
    days: list[DayOut]
    summary: Summary


class RangeOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: date = Field(alias="from")
    to: date
    summary: Summary


class GridRow(BaseModel):
    user: UserBrief
    days: list[DayOut]
    summary: Summary


class Grid(BaseModel):
    month: str
    items: list[GridRow]


class ClosingEvent(BaseModel):
    action: Literal["close", "reopen"]
    at: datetime
    by: Person
    reason: str | None = None  # 해제에만


class ClosingOut(BaseModel):
    month: str
    status: Literal["open", "closed"]
    closed_at: datetime | None  # closed 면 항상 있다
    closed_by: Person | None
    history: list[ClosingEvent]  # 최신순 — 감사 로그 투영(#158 B3)


class CloseIn(BaseModel):
    month: MonthStr


class ReopenIn(BaseModel):
    month: MonthStr
    reason: str | None = Field(None, max_length=500)


class Items[T](BaseModel):
    items: list[T]


# ── 달력 ──────────────────────────────────────────────────────────────────


def _month_bounds(month: str) -> tuple[date, date]:
    first = date.fromisoformat(f"{month}-01")
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    return first, nxt - timedelta(days=1)


def _dates(start: date, end: date):
    for n in range((end - start).days + 1):
        yield start + timedelta(days=n)


def _check_range(start: date, end: date) -> None:
    if end < start:
        raise ApiError(422, "VALIDATION", "기간이 올바르지 않습니다.")
    if (end - start).days + 1 > RANGE_MAX_DAYS:
        raise ApiError(422, "VALIDATION", f"기간은 {RANGE_MAX_DAYS}일까지입니다.")


async def holidays_in(db: AsyncSession, start: date, end: date) -> dict[date, str]:
    rows = await db.execute(
        select(Holiday.date, Holiday.kind).where(Holiday.date >= start, Holiday.date <= end)
    )
    return dict(rows.all())


def workdays(start: date, end: date, holidays: dict[date, str]) -> list[date]:
    return [d for d in _dates(start, end) if d.weekday() < 5 and d not in holidays]


async def closed_between(db: AsyncSession, start: date, end: date) -> bool:
    """기간이 마감된 달을 하나라도 지나는가 — 양끝만 보면 석 달짜리 출장의 가운데 달이 샌다."""
    found = await db.scalar(
        select(AttClosing.month)
        .where(AttClosing.month >= f"{start:%Y-%m}", AttClosing.month <= f"{end:%Y-%m}")
        .limit(1)
    )
    return found is not None


def _month_closed() -> ApiError:
    return ApiError(
        409, "MONTH_CLOSED", "마감된 달입니다. 신청하려면 임원이 마감을 해제해야 합니다."
    )


async def request_in_closed_month(db: AsyncSession, approval_id: uuid.UUID) -> bool:
    """근태 결재 문서의 신청 기간이 마감된 달에 걸리는가 — 승인 직전에 approvals 가 묻는다."""
    for model, start, end in (
        (LeaveRequest, LeaveRequest.start_date, LeaveRequest.end_date),
        (WorkArrangement, WorkArrangement.start_date, WorkArrangement.end_date),
        (OvertimeRequest, OvertimeRequest.work_date, OvertimeRequest.work_date),
        (AttCorrection, AttCorrection.work_date, AttCorrection.work_date),
    ):
        row = (await db.execute(select(start, end).where(model.approval_id == approval_id))).first()
        if row is not None:
            return await closed_between(db, row[0], row[1])
    return False


def _approved(model):
    return (
        select(model)
        .join(ApprovalDocument, ApprovalDocument.id == model.approval_id)
        .where(ApprovalDocument.status == "approved")
    )


async def _days(
    db: AsyncSession, user_ids: list[uuid.UUID], start: date, end: date
) -> dict[uuid.UUID, list[DayOut]]:
    """사람마다 [start, end] 의 일자 행(10 §5.2)."""
    holidays = await holidays_in(db, start, end)
    by_user = defaultdict(list)
    for model, lo, hi in (
        (LeaveRequest, LeaveRequest.start_date, LeaveRequest.end_date),
        (WorkArrangement, WorkArrangement.start_date, WorkArrangement.end_date),
        (OvertimeRequest, OvertimeRequest.work_date, OvertimeRequest.work_date),
        (AttCorrection, AttCorrection.work_date, AttCorrection.work_date),
    ):
        stmt = _approved(model).where(model.user_id.in_(user_ids), lo <= end, hi >= start)
        for row in await db.scalars(stmt.order_by(model.created_at)):
            by_user[(row.user_id, model)].append(row)

    out: dict[uuid.UUID, list[DayOut]] = {}
    for uid in user_ids:
        leaves = by_user[(uid, LeaveRequest)]
        arrangements = by_user[(uid, WorkArrangement)]
        overtime = defaultdict(list)
        for o in by_user[(uid, OvertimeRequest)]:
            overtime[o.work_date].append(o)
        corrections = defaultdict(list)
        for c in by_user[(uid, AttCorrection)]:
            corrections[c.work_date].append(c)
        rows = []
        for d in _dates(start, end):
            if d.weekday() >= 5 or d in holidays:
                if not overtime[d]:
                    continue  # 쉬는 날은 행이 없다 — 휴일근로가 승인된 날만
                kind = {"public": "public_holiday", "company": "company_holiday"}.get(
                    holidays.get(d, ""), "weekly_holiday"
                )
                day = DayOut(
                    work_date=d,
                    day_kind=kind,
                    status="holiday",
                    worked_days=0,
                    overtime_minutes=0,
                    night_minutes=0,
                    note=None,
                )
            else:
                day = DayOut(
                    work_date=d,
                    day_kind="workday",
                    status="normal",
                    worked_days=1,
                    overtime_minutes=0,
                    night_minutes=0,
                    note=None,
                )
                leave = next((r for r in leaves if r.start_date <= d <= r.end_date), None)
                arr = next((r for r in arrangements if r.start_date <= d <= r.end_date), None)
                if leave is not None:
                    half = LEAVE_BY_CODE[leave.type_code].unit == "half"
                    day.status, day.worked_days = ("half_leave", 0.5) if half else ("leave", 0)
                elif arr is not None:
                    day.status = arr.kind
            for c in corrections[d]:  # 승인된 정정이 마지막에 덮는다(늦게 낸 것이 이긴다)
                if c.after.get("status"):
                    day.status = c.after["status"]
                    day.worked_days = WORKED[day.status]
                if c.after.get("note"):
                    day.note = c.after["note"]
            for o in overtime[d]:
                day.overtime_minutes += o.minutes
                day.night_minutes += o.night_minutes
            rows.append(day)
        out[uid] = rows
    return out


def _summary(days: list[DayOut]) -> Summary:
    now = today()
    return Summary(
        worked_days=sum(d.worked_days for d in days if d.work_date <= now),
        leave_days=sum({"leave": 1, "half_leave": 0.5}.get(d.status, 0) for d in days),
        overtime_minutes=sum(d.overtime_minutes for d in days),
        night_minutes=sum(d.night_minutes for d in days),
    )


# ── 개인 (§10.1) ──────────────────────────────────────────────────────────


@router.get(
    "/attendance/me",
    response_model=MonthOut,
    summary="?month=YYYY-MM 근무일 배열 + 월 집계 {days[], summary}",
)
async def my_month(
    month: MonthStr, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> MonthOut:
    first, last = _month_bounds(month)
    days = (await _days(db, [user.id], first, last))[user.id]
    return MonthOut(month=month, days=days, summary=_summary(days))


@router.get(
    "/attendance/me/summary",
    response_model=RangeOut,
    summary="?from=&to= 기간 집계 {from, to, summary} — 양끝 포함 366일까지",
)
async def my_range(
    from_: Annotated[date, Query(alias="from")],
    to: date,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> RangeOut:
    _check_range(from_, to)
    days = (await _days(db, [user.id], from_, to))[user.id]
    return RangeOut(from_=from_, to=to, summary=_summary(days))


# ── 신청 공통 ─────────────────────────────────────────────────────────────


def _with_doc(model):
    return select(model, ApprovalDocument.status, ApprovalDocument.closed_at).join(
        ApprovalDocument, ApprovalDocument.id == model.approval_id
    )


def _state(doc_status: str, closed_at: datetime | None) -> dict:
    status = REQUEST_STATUS[doc_status]
    return {"status": status, "decided_at": None if status == "pending" else closed_at}


async def _lock(db: AsyncSession, key: str) -> None:
    """트랜잭션 자문 잠금 — 같은 사람의 잔여 확인과 넣기, 같은 달의 마감·해제를 직렬화한다."""
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))


async def _create(
    db: AsyncSession, user: User, type_code: str, title: str, body: str, row, now: datetime
) -> dict:
    """신청 행 + 결재 문서(상신까지). 반환은 응답의 상태 칸."""
    doc, notes = await approvals.start_request(db, user, type_code, title, body, now)
    row.approval_id = doc.id
    db.add(row)
    await db.commit()
    await approvals.push(notes)
    return _state(doc.status, doc.closed_at)


async def _cancel(db: AsyncSession, user: User, model, id: uuid.UUID, not_found: str):
    row = await db.get(model, id)
    if row is None or row.user_id != user.id:
        raise ApiError(404, "NOT_FOUND", not_found)
    doc = await approvals.cancel_request(db, row.approval_id)
    await db.commit()
    return row, _state(doc.status, doc.closed_at)


# ── 예외 근무·연장·정정 (§10.3) ────────────────────────────────────────────


def _arrangement_out(row: WorkArrangement, state: dict) -> ArrangementOut:
    return ArrangementOut(
        id=row.id,
        kind=row.kind,
        start_date=row.start_date,
        end_date=row.end_date,
        reason=row.reason,
        created_at=row.created_at,
        **state,
    )


@router.post(
    "/attendance/arrangements",
    status_code=201,
    response_model=ArrangementOut,
    summary="{kind, start_date, end_date, reason} 재택·외근·출장 → 결재 상신. 마감된 달 409 MONTH_CLOSED",
)
async def create_arrangement(
    body: ArrangementIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ArrangementOut:
    _check_range(body.start_date, body.end_date)
    if await closed_between(db, body.start_date, body.end_date):
        raise _month_closed()
    now = datetime.now(UTC)
    row = WorkArrangement(
        user_id=user.id,
        kind=body.kind,
        start_date=body.start_date,
        end_date=body.end_date,
        reason=body.reason,
        created_at=now,
    )
    name = ARRANGEMENT_NAME[body.kind]
    state = await _create(
        db,
        user,
        "arrangement",
        f"[{name}] {body.start_date} ~ {body.end_date}",
        f"{name} {body.start_date} ~ {body.end_date}\n사유: {body.reason}",
        row,
        now,
    )
    return _arrangement_out(row, state)


@router.get(
    "/attendance/arrangements",
    summary="?scope=me 내 예외 근무 · ?scope=all&from=&to= 전 직원의 승인분(홈 캘린더, 사유 없음)",
    response_model=Items[ArrangementOut] | Items[ArrangementOnCalendar],
)
async def list_arrangements(
    scope: Literal["me", "all"] = "me",
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if scope == "all":
        if from_ is None or to is None:
            raise ApiError(422, "VALIDATION", "from·to 가 필요합니다.")
        _check_range(from_, to)
        stmt = (
            _approved(WorkArrangement)
            .add_columns(User.name)
            .join(User, User.id == WorkArrangement.user_id)
            .where(WorkArrangement.start_date <= to, WorkArrangement.end_date >= from_)
            .order_by(WorkArrangement.start_date)
        )
        return Items(
            items=[
                ArrangementOnCalendar(
                    id=r.id,
                    user=Person(id=r.user_id, name=name),
                    kind=r.kind,
                    start_date=r.start_date,
                    end_date=r.end_date,
                )
                for r, name in await db.execute(stmt)
            ]
        )
    rows = await db.execute(
        _with_doc(WorkArrangement)
        .where(WorkArrangement.user_id == user.id)
        .order_by(WorkArrangement.start_date.desc())
    )
    return Items(items=[_arrangement_out(r, _state(s, c)) for r, s, c in rows])


def overtime_minutes(start: str, end: str) -> tuple[int, int]:
    """(인정 분, 야간 분) — 10 §5.3. 소정 종업 18:00 이후만, 끝이 시작보다 이르면 자정을 넘긴 것(같으면 0).
    야간은 [22:00, 익일 06:00] 과의 교집합. 프론트 `overtimeMinutes.ts` 와 같은 식."""
    s = int(start[:2]) * 60 + int(start[3:])
    e = int(end[:2]) * 60 + int(end[3:])
    if e < s:
        e += 24 * 60
    s = max(s, 18 * 60)
    if e <= s:
        return 0, 0
    return e - s, max(0, min(e, 30 * 60) - max(s, 22 * 60))


def _overtime_out(row: OvertimeRequest, state: dict) -> OvertimeOut:
    return OvertimeOut(
        id=row.id,
        work_date=row.work_date,
        start_time=row.start_time,
        end_time=row.end_time,
        minutes=row.minutes,
        night_minutes=row.night_minutes,
        reason=row.reason,
        created_at=row.created_at,
        **state,
    )


@router.post(
    "/attendance/overtime",
    status_code=201,
    response_model=OvertimeOut,
    summary="{work_date, start_time, end_time, reason} 연장근로 → 결재 상신. 18:00 이후 구간 없으면 422",
)
async def create_overtime(
    body: OvertimeIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> OvertimeOut:
    minutes, night = overtime_minutes(body.start_time, body.end_time)
    if minutes == 0:
        raise ApiError(422, "VALIDATION", "소정 종업 시각(18:00) 이후 구간이 없습니다.")
    if await closed_between(db, body.work_date, body.work_date):
        raise _month_closed()
    now = datetime.now(UTC)
    row = OvertimeRequest(
        user_id=user.id,
        work_date=body.work_date,
        start_time=body.start_time,
        end_time=body.end_time,
        minutes=minutes,
        night_minutes=night,
        reason=body.reason,
        created_at=now,
    )
    span = f"{body.work_date} {body.start_time}~{body.end_time}"
    state = await _create(
        db,
        user,
        "overtime",
        f"[연장근로] {span}",
        f"연장근로 {span} ({minutes}분, 야간 {night}분)\n사유: {body.reason}",
        row,
        now,
    )
    return _overtime_out(row, state)


@router.get(
    "/attendance/overtime",
    response_model=OvertimePage,
    summary="?from=&to= 내 연장근로 목록(일자 최근 순) + 승인분 누계",
)
async def list_overtime(
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> OvertimePage:
    stmt = _with_doc(OvertimeRequest).where(OvertimeRequest.user_id == user.id)
    if from_ is not None:
        stmt = stmt.where(OvertimeRequest.work_date >= from_)
    if to is not None:
        stmt = stmt.where(OvertimeRequest.work_date <= to)
    items = [
        _overtime_out(r, _state(s, c))
        for r, s, c in await db.execute(stmt.order_by(OvertimeRequest.work_date.desc()))
    ]
    approved = [i for i in items if i.status == "approved"]
    return OvertimePage(
        items=items,
        summary=OvertimeSum(
            minutes=sum(i.minutes for i in approved),
            night_minutes=sum(i.night_minutes for i in approved),
        ),
    )


def _correction_out(row: AttCorrection, state: dict) -> CorrectionOut:
    return CorrectionOut(
        id=row.id,
        work_date=row.work_date,
        after=CorrectionAfter.model_validate(row.after),
        reason=row.reason,
        created_at=row.created_at,
        **state,
    )


@router.post(
    "/attendance/corrections",
    status_code=201,
    response_model=CorrectionOut,
    summary="{work_date, after:{status?, note?}, reason} 정정 신청 → 결재 상신. 바꿀 내용 없으면 422",
)
async def create_correction(
    body: CorrectionIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> CorrectionOut:
    after = body.after.model_dump(exclude_none=True)
    if not after.get("status") and not (after.get("note") or "").strip():
        raise ApiError(422, "VALIDATION", "바꿀 내용이 없습니다.")
    if await closed_between(db, body.work_date, body.work_date):
        raise _month_closed()
    # ponytail: 승인 전 값(before)은 보관하지 않는다 — 일자 상태는 신청들로부터 언제든 다시 계산된다
    now = datetime.now(UTC)
    row = AttCorrection(
        user_id=user.id, work_date=body.work_date, after=after, reason=body.reason, created_at=now
    )
    change = ", ".join(f"{k}={v}" for k, v in after.items())
    state = await _create(
        db,
        user,
        "correction",
        f"[근태 정정] {body.work_date}",
        f"근태 정정 {body.work_date} → {change}\n사유: {body.reason}",
        row,
        now,
    )
    return _correction_out(row, state)


@router.get(
    "/attendance/corrections",
    response_model=Items[CorrectionOut],
    summary="내 정정 신청 목록(일자 최근 순)",
)
async def list_corrections(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[CorrectionOut]:
    rows = await db.execute(
        _with_doc(AttCorrection)
        .where(AttCorrection.user_id == user.id)
        .order_by(AttCorrection.work_date.desc())
    )
    return Items(items=[_correction_out(r, _state(s, c)) for r, s, c in rows])


STORES = {
    "arrangements": (WorkArrangement, _arrangement_out),
    "overtime": (OvertimeRequest, _overtime_out),
    "corrections": (AttCorrection, _correction_out),
}


@router.post(
    "/attendance/{store}/{id}/cancel",
    response_model=ArrangementOut | OvertimeOut | CorrectionOut,
    summary="예외 근무·연장·정정의 승인 전 취소(결재 회수) — 내 것만(404), 처리된 것 409 REQUEST_DECIDED",
)
async def cancel_exception(
    store: Literal["arrangements", "overtime", "corrections"],
    id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    model, out = STORES[store]
    row, state = await _cancel(db, user, model, id, "신청을 찾을 수 없습니다.")
    return out(row, state)


# ── 휴가 (§10.2) ──────────────────────────────────────────────────────────


@router.get("/leave-types", response_model=Items[LeaveTypeOut], summary="휴가 종류 목록")
async def leave_types() -> Items[LeaveTypeOut]:
    return Items(items=LEAVE_TYPES)


async def _used(db: AsyncSession, user_ids: list[uuid.UUID], year: int) -> dict[uuid.UUID, float]:
    """잔여는 칸이 아니라 신청 합계(10 §4.2.5) — 승인 + 대기. 시작일이 그 해인 것.

    ponytail: 해를 넘기는 휴가(12/30~1/2)는 시작한 해에 전부 센다."""
    rows = await db.execute(
        select(LeaveRequest.user_id, func.sum(LeaveRequest.days))
        .join(ApprovalDocument, ApprovalDocument.id == LeaveRequest.approval_id)
        .where(
            LeaveRequest.user_id.in_(user_ids),
            ApprovalDocument.status.in_(["pending", "approved"]),
            LeaveRequest.start_date >= date(year, 1, 1),
            LeaveRequest.start_date <= date(year, 12, 31),
        )
        .group_by(LeaveRequest.user_id)
    )
    return {uid: float(total or 0) for uid, total in rows}


def _balance(year: int, used: float) -> LeaveBalanceOut:
    return LeaveBalanceOut(
        year=year,
        granted=GRANTED_DAYS,
        used=used,
        remaining=GRANTED_DAYS - used,
        expires_on=date(year, 12, 31),
        grant_basis="fiscal_year",
    )


@router.get(
    "/leaves/balance",
    response_model=LeaveBalanceOut,
    summary="{year, granted, used, remaining, expires_on, grant_basis} 올해 내 연차",
)
async def my_balance(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> LeaveBalanceOut:
    year = today().year
    return _balance(year, (await _used(db, [user.id], year)).get(user.id, 0))


def _brief(user: User, team: Team | None) -> UserBrief:
    return UserBrief(
        id=user.id,
        name=user.name,
        role=user.role,
        team=TeamOut(id=team.id, name=team.name) if team else None,
    )


async def _staff(
    db: AsyncSession, team_id: uuid.UUID | None = None
) -> list[tuple[User, Team | None]]:
    """활성 사용자(이름순) + 팀."""
    stmt = (
        select(User, Team)
        .outerjoin(Team, Team.id == User.team_id)
        .where(User.active.is_(True))
        .order_by(User.name, User.id)
    )
    if team_id is not None:
        stmt = stmt.where(User.team_id == team_id)
    return list((await db.execute(stmt)).tuples())


@router.get(
    "/leaves/balances",
    response_model=Items[LeaveBalanceRow],
    summary="전 직원의 올해 연차 잔여(연차 관리) — exec, 그 밖 403",
)
async def all_balances(
    _: User = Depends(require_exec), db: AsyncSession = Depends(get_db)
) -> Items[LeaveBalanceRow]:
    year = today().year
    staff = await _staff(db)
    used = await _used(db, [u.id for u, _ in staff], year)
    return Items(
        items=[
            LeaveBalanceRow(**_balance(year, used.get(u.id, 0)).model_dump(), user=_brief(u, t))
            for u, t in staff
        ]
    )


def _leave_out(row: LeaveRequest, state: dict) -> LeaveOut:
    return LeaveOut(
        id=row.id,
        type_code=row.type_code,
        start_date=row.start_date,
        end_date=row.end_date,
        days=row.days,
        reason=row.reason,
        created_at=row.created_at,
        **state,
    )


@router.get(
    "/leaves",
    summary="?scope=me 내 휴가 · ?scope=all&from=&to= 전 직원의 승인 휴가(홈 캘린더, 사유 없음)",
    response_model=Items[LeaveOut] | Items[LeaveOnCalendar],
)
async def list_leaves(
    scope: Literal["me", "all"] = "me",
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if scope == "all":
        if from_ is None or to is None:
            raise ApiError(422, "VALIDATION", "from·to 가 필요합니다.")
        _check_range(from_, to)
        stmt = (
            _approved(LeaveRequest)
            .add_columns(User.name)
            .join(User, User.id == LeaveRequest.user_id)
            .where(LeaveRequest.start_date <= to, LeaveRequest.end_date >= from_)
            .order_by(LeaveRequest.start_date)
        )
        return Items(
            items=[
                LeaveOnCalendar(
                    id=r.id,
                    user=Person(id=r.user_id, name=name),
                    type_code=r.type_code,
                    start_date=r.start_date,
                    end_date=r.end_date,
                )
                for r, name in await db.execute(stmt)
            ]
        )
    rows = await db.execute(
        _with_doc(LeaveRequest)
        .where(LeaveRequest.user_id == user.id)
        .order_by(LeaveRequest.start_date.desc())
    )
    return Items(items=[_leave_out(r, _state(s, c)) for r, s, c in rows])


@router.post(
    "/leaves",
    status_code=201,
    response_model=LeaveOut,
    summary="{type_code, start_date, end_date, reason?} → 결재 상신. 잔여 부족 422 LEAVE_INSUFFICIENT, 마감된 달 409",
)
async def create_leave(
    body: LeaveIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> LeaveOut:
    kind = LEAVE_BY_CODE.get(body.type_code)
    if kind is None:
        raise ApiError(422, "VALIDATION", "없는 휴가 종류입니다.")
    start = body.start_date
    end = start if kind.unit == "half" else (body.end_date or start)
    _check_range(start, end)
    reason = (body.reason or "").strip()
    if kind.deduct_days == 0 and not reason:  # 연차·반차는 사유를 받지 않는다(근기법 §60)
        raise ApiError(422, "VALIDATION", "사유를 입력해 주세요.")
    await _lock(db, f"leave:{user.id}")  # 잔여 확인과 넣기 사이에 같은 사람의 다른 신청이 끼지 않게
    if await closed_between(db, start, end):
        raise _month_closed()
    n = len(workdays(start, end, await holidays_in(db, start, end)))
    if n == 0:
        raise ApiError(422, "VALIDATION", "근무일이 없는 기간입니다.")
    days = kind.deduct_days if kind.unit == "half" else n * kind.deduct_days
    if days > 0:
        used = (await _used(db, [user.id], start.year)).get(user.id, 0)
        if days > GRANTED_DAYS - used:
            raise ApiError(422, "LEAVE_INSUFFICIENT", "잔여 연차가 부족합니다.")
    now = datetime.now(UTC)
    row = LeaveRequest(
        user_id=user.id,
        type_code=kind.code,
        start_date=start,
        end_date=end,
        days=days,
        reason=reason,
        created_at=now,
    )
    span = f"{start}" if start == end else f"{start} ~ {end}"
    state = await _create(
        db,
        user,
        "leave",
        f"[휴가] {kind.name} {span}",
        f"{kind.name} {span} ({days:g}일)" + (f"\n사유: {reason}" if reason else ""),
        row,
        now,
    )
    return _leave_out(row, state)


@router.post(
    "/leaves/{id}/cancel",
    response_model=LeaveOut,
    summary="승인 전 취소(결재 회수) — 내 것만(404), 처리된 것 409 REQUEST_DECIDED",
)
async def cancel_leave(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> LeaveOut:
    row, state = await _cancel(db, user, LeaveRequest, id, "휴가 신청을 찾을 수 없습니다.")
    return _leave_out(row, state)


# ── 팀·리포트 (§10.5) ─────────────────────────────────────────────────────


@router.get(
    "/attendance/team",
    response_model=Grid,
    summary="?month=&team_id= 팀원 × 일자 그리드 — 팀장(teams.lead_id)·exec 만, team_id 없으면 전사(exec). 그 밖 403",
)
async def team_grid(
    month: MonthStr,
    request: Request,
    team_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Grid:
    team = await db.get(Team, team_id) if team_id is not None else None
    # 팀장 판정은 teams.lead_id 로만, fail-closed(README 18(b)) — NULL 은 "팀장 없음"이지 "아무나"가 아니다
    is_lead = team is not None and team.lead_id is not None and team.lead_id == user.id
    if user.role != "exec" and not is_lead:
        audit.record(
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=team_id,
            detail={"path": request.url.path, "reason": "team" if team_id else "company"},
        )
        await db.commit()
        raise ApiError(
            403,
            "FORBIDDEN",
            "권한이 부족합니다." if team_id else "전사 근태는 임원만 볼 수 있습니다.",
        )
    if team_id is not None and team is None:
        raise ApiError(404, "NOT_FOUND", "없는 팀입니다.")
    first, last = _month_bounds(month)
    staff = await _staff(db, team_id)
    days = await _days(db, [u.id for u, _ in staff], first, last)
    return Grid(
        month=month,
        items=[
            GridRow(user=_brief(u, t), days=days[u.id], summary=_summary(days[u.id]))
            for u, t in staff
        ],
    )


def _cell(value) -> str:
    """CSV 수식 주입 막기 — 엑셀이 =·+·-·@ 로 시작하는 칸을 수식으로 읽는다."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@router.get(
    "/attendance/report",
    summary="?month=&format=csv 월 리포트 (exec) — 사람마다 근무일·휴가일·연장·야간(분). UTF-8 BOM",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def report(
    month: MonthStr,
    format: Literal["csv"] = "csv",
    _: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> Response:
    first, last = _month_bounds(month)
    staff = await _staff(db)
    days = await _days(db, [u.id for u, _ in staff], first, last)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["이름", "팀", "근무일", "휴가일", "연장(분)", "야간(분)"])
    for u, t in staff:
        s = _summary(days[u.id])
        w.writerow(
            [_cell(u.name), _cell(t.name if t else ""), f"{s.worked_days:g}", f"{s.leave_days:g}"]
            + [s.overtime_minutes, s.night_minutes]
        )
    return Response(
        "﻿" + buf.getvalue(),  # BOM — 엑셀이 한글을 UTF-8 로 읽게
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="attendance-{month}.csv"'},
    )


# ── 월 마감 (10 §5.5 · §9.5) ──────────────────────────────────────────────

CLOSING_KINDS = {"attendance.closed": "close", "attendance.reopened": "reopen"}


async def _closings(db: AsyncSession, months: list[str]) -> list[ClosingOut]:
    """마감 상태 = att_closings 행, 이력 = 감사 로그 투영(#158 B3 기본안)."""
    closed = {
        c.month: (c, name)
        for c, name in await db.execute(
            select(AttClosing, User.name)
            .join(User, User.id == AttClosing.closed_by)
            .where(AttClosing.month.in_(months))
        )
    }
    history = defaultdict(list)
    for e, name in await db.execute(
        select(AuditEvent, User.name)
        .join(User, User.id == AuditEvent.actor_id)
        .where(
            AuditEvent.kind.in_(CLOSING_KINDS),
            AuditEvent.detail["month"].astext.in_(months),
        )
        .order_by(AuditEvent.at.desc(), AuditEvent.id.desc())
    ):
        history[e.detail["month"]].append(
            ClosingEvent(
                action=CLOSING_KINDS[e.kind],
                at=e.at,
                by=Person(id=e.actor_id, name=name),
                reason=e.detail.get("reason"),
            )
        )
    out = []
    for m in months:
        row = closed.get(m)
        out.append(
            ClosingOut(
                month=m,
                status="closed" if row else "open",
                closed_at=row[0].closed_at if row else None,
                closed_by=Person(id=row[0].closed_by, name=row[1]) if row else None,
                history=history[m],
            )
        )
    return out


@router.get(
    "/attendance/closings",
    response_model=Items[ClosingOut],
    summary="?year= 열두 달의 마감 상태와 이력 — 로그인하면 누구나",
)
async def list_closings(
    year: int = Query(ge=2000, le=2100), db: AsyncSession = Depends(get_db)
) -> Items[ClosingOut]:
    return Items(items=await _closings(db, [f"{year}-{m:02d}" for m in range(1, 13)]))


@router.get(
    "/attendance/closings/{month}",
    response_model=ClosingOut,
    summary="한 달의 마감 상태와 마감·해제 이력(최신순) — 로그인하면 누구나",
)
async def get_closing(month: MonthStr, db: AsyncSession = Depends(get_db)) -> ClosingOut:
    return (await _closings(db, [month]))[0]


@router.post(
    "/attendance/close",
    response_model=ClosingOut,
    summary="{month} 월 마감 (exec) — 오지 않은 달 422, 이미 마감 409 ALREADY_CLOSED. 감사 attendance.closed",
)
async def close_month(
    body: CloseIn,
    request: Request,
    user: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> ClosingOut:
    if body.month > f"{today():%Y-%m}":
        raise ApiError(422, "VALIDATION", "아직 오지 않은 달은 마감할 수 없습니다.")
    await _lock(db, f"closing:{body.month}")
    if await db.get(AttClosing, body.month) is not None:
        raise ApiError(409, "ALREADY_CLOSED", "이미 마감된 달입니다.")
    now = datetime.now(UTC)
    db.add(AttClosing(month=body.month, closed_at=now, closed_by=user.id))
    audit.record(
        db,
        "attendance.closed",
        request=request,
        actor_id=user.id,
        detail={"month": body.month},
        at=now,
    )
    await db.commit()
    return (await _closings(db, [body.month]))[0]


@router.post(
    "/attendance/reopen",
    response_model=ClosingOut,
    summary="{month, reason} 월 마감 해제 (exec) — 마감 안 된 달 409 NOT_CLOSED, 사유 필수 422. 감사 attendance.reopened",
)
async def reopen_month(
    body: ReopenIn,
    request: Request,
    user: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> ClosingOut:
    await _lock(db, f"closing:{body.month}")
    row = await db.get(AttClosing, body.month)
    if row is None:
        raise ApiError(409, "NOT_CLOSED", "마감되지 않은 달입니다.")
    reason = (body.reason or "").strip()
    if not reason:
        raise ApiError(422, "VALIDATION", "해제 사유를 입력해 주세요.")
    await db.delete(row)
    audit.record(
        db,
        "attendance.reopened",
        request=request,
        actor_id=user.id,
        detail={"month": body.month, "reason": reason},
        at=datetime.now(UTC),
    )
    await db.commit()
    return (await _closings(db, [body.month]))[0]
