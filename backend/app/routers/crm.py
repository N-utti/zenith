"""CRM 주소록·안건 (README "설계와 어긋나는 것" 32 · 15 CRM 모듈 설계서 §9 — 04·03 밖).

프론트 목(`mocks/crmDb.ts`·`handlers.ts` 의 `/api/crm`)을 역설계한 계약 그대로.
- 권한: 로그인하면 누구나 읽고 쓴다. 예외는 기관 삭제·담당자 개인정보 삭제(exec), 활동 고치기·지우기(작성자·exec),
  성사(won) 안건의 단계 되돌리기(exec — 아니면 409). 403 은 전부 감사 `acl.denied`(boards.py `_deny` 와 같음).
- 기관·활동 삭제는 soft delete. 지운 기관은 목록·상세·그 기관의 안건·활동 조회에서 404, 본문 참조로 오면 422.
- 안건 수정·중단·재개는 `version` 낙관적 잠금 — 행을 `FOR UPDATE` 로 읽고 비교, 어긋나면(누락 포함) 409.
- 목록은 페이징 없이 `{items, next_cursor: null}`(프론트 목 모양). 400 은 없다 — 검증 실패는 전부 422 `VALIDATION`.
- 감사: crm.exported · crm.imported · crm.org_deleted · crm.contact_erased · crm.activity_deleted.

ponytail: 정렬「한글순」은 정규화 이름의 코드포인트 순(파이썬 sort) — 한글 음절은 코드포인트가 가나다순이다.
DB collation 에 기대지 않는다. 주소록이 수만 건이 되면 ORDER BY ... COLLATE "ko-KR-x-icu" 로.
"""

import csv
import io
import re
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, Query, Request, Response, UploadFile
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt, StringConstraints
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    CrmActivity,
    CrmActivityContact,
    CrmActivityUser,
    CrmContact,
    CrmContactMove,
    CrmDeal,
    CrmDealEvent,
    CrmImport,
    CrmOrg,
    CrmOrgOwner,
    User,
)

router = APIRouter(prefix="/crm", tags=["crm"], dependencies=[Depends(current_user)])

# ── 열거형·라벨 — 프론트 `features/crm/types.ts` 상수 그대로 ─────────────────────────────

OrgType = Literal[
    "pension",
    "mutual_aid",
    "insurance",
    "bank",
    "securities",
    "am",
    "asset_owner",
    "advisor",
    "etc",
]
ORG_TYPE_LABEL = {
    "pension": "연기금",
    "mutual_aid": "공제회",
    "insurance": "보험",
    "bank": "은행",
    "securities": "증권",
    "am": "운용사",
    "asset_owner": "자산 소유자",
    "advisor": "자문사",
    "etc": "기타",
}
TYPE_BY_LABEL = {label: key for key, label in ORG_TYPE_LABEL.items()}
ActivityKind = Literal["meeting", "call", "email", "memo"]
DealKind = Literal["fundraising", "investment", "disposal"]
DEAL_KIND_LABEL = {"fundraising": "출자 유치", "investment": "투자 안건", "disposal": "매각"}
# 종류별 단계(15 §4.2.1 기본안, B2 두 팀 확인 대기). 마지막 단계에 닿으면 성사(won).
STAGES: dict[str, list[tuple[str, str]]] = {
    "fundraising": [
        ("contact", "접촉"),
        ("proposal", "제안서 발송"),
        ("diligence", "실사"),
        ("committee", "내부 심의 대기"),
        ("committed", "출자 확약"),
    ],
    "investment": [
        ("sourcing", "발굴"),
        ("screening", "예비 검토"),
        ("diligence", "실사"),
        ("committee", "투자심의"),
        ("closed", "투자 실행"),
    ],
    "disposal": [
        ("marketing", "원매자 접촉"),
        ("prelim_bid", "예비입찰"),
        ("diligence", "실사·본입찰"),
        ("preferred", "우선협상"),
        ("closed", "거래 종결"),
    ],
}
DEAL_STATUS_LABEL = {"open": "진행 중", "won": "성사", "dropped": "중단"}

FUTURE_SLACK = timedelta(minutes=5)  # 기기 시계가 조금 빠른 것은 봐준다
REASON_MAX = 500
IMPORT_MAX_BYTES = 1024 * 1024
IMPORT_MAX_ROWS = 2000
IMPORT_HEADERS = {
    "org": "기관",
    "type": "유형",
    "name": "이름",
    "title": "부서·직함",
    "phone": "전화",
    "email": "이메일",
    "memo": "메모",
}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# ponytail: 한국은 서머타임이 없어 +9 고정. zoneinfo 는 윈도우에 tzdata 가 없어 따로 깔아야 한다.
KST = timezone(timedelta(hours=9))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

OrgName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Memo = Annotated[str, StringConstraints(max_length=2000)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
ContactName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, max_length=200, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]
DealName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
NextAction = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Amount = Annotated[
    StrictInt, Field(ge=0, le=2**53 - 1)
]  # 정수만("1000"·1.0 거부), 프론트 number 가 정확히 담는 범위
Ids = Annotated[list[uuid.UUID], Field(max_length=200)]  # 참석자·창구 상한
ActivityBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]


# ── 응답·요청 모양 ─────────────────────────────────────────────────────────────


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None  # 페이징 없음 — 늘 null(프론트 목 모양)


class OrgItem(BaseModel):
    id: uuid.UUID
    name: str
    org_type: str
    owners: list[Person]  # 사내 창구, 이름순
    contact_count: int  # 개인정보를 지운 담당자는 빼고 센다
    last_contacted_at: datetime | None  # 지우지 않은 활동의 occurred_at 최댓값


class Move(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: Person = Field(alias="from")
    moved_at: datetime


class ContactOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str  # erased 면 "" — 화면이 「삭제된 담당자」로 그린다
    title: str
    phone: str
    email: str
    memo: str
    erased: bool
    can_delete: bool  # 등록한 사람(지우지 않은 활동에 붙기 전)·exec — 요청자마다 서버가 판정
    moves: list[Move]  # 이전 소속, 최근 것부터


class OrgDetail(OrgItem):
    memo: str
    contacts: list[ContactOut]  # erased 포함, 목록에서 지운 담당자는 뺀다
    created_at: datetime


class DeletedOrg(BaseModel):
    id: uuid.UUID
    name: str
    org_type: str
    deleted_at: datetime
    reason: str  # 지울 때 적은 사유
    duplicate: Person | None  # 그사이 정규화 이름이 같은 기관이 생겼으면 — 되살리기는 막지 않는다


class LastImport(BaseModel):
    id: uuid.UUID
    created_at: datetime
    new_orgs: int
    new_contacts: int


class LastImportOut(BaseModel):
    import_: LastImport | None = Field(alias="import")  # 되돌릴 것이 없거나 기한이 지났으면 null

    model_config = ConfigDict(populate_by_name=True)


class ImportUndone(BaseModel):
    removed_orgs: int
    removed_contacts: int
    kept_orgs: int  # 그사이 쓰이기 시작해 남긴 것
    kept_contacts: int


class OrgCreated(BaseModel):
    org: OrgDetail
    duplicates: list[Person]  # 정규화 이름이 같은 기존 기관 — 막지 않고 알리기만


class OrgIn(BaseModel):
    name: OrgName
    org_type: OrgType
    memo: Memo = ""
    owner_ids: Ids = []


class OrgPatch(BaseModel):
    name: OrgName | None = None
    org_type: OrgType | None = None
    memo: Memo | None = None
    owner_ids: Ids | None = None


class OrgDeleteIn(BaseModel):
    reason: str = ""


class ContactIn(BaseModel):
    org_id: uuid.UUID
    name: ContactName
    title: Short = ""
    phone: Short = ""
    email: Email = ""
    memo: Memo = ""


class ContactPatch(BaseModel):
    org_id: uuid.UUID | None = None  # 지금과 다르면 이직
    name: ContactName | None = None
    title: Short | None = None
    phone: Short | None = None
    email: Email | None = None
    memo: Memo | None = None


class DealOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    org: Person
    owner: Person | None
    stage: str
    amount_krw: int | None
    target_date: date | None
    next_action: str
    next_action_due: date | None
    status: str  # open|won|dropped
    version: int


class DealEventOut(BaseModel):
    id: uuid.UUID
    actor: Person
    from_stage: str | None
    to_stage: str
    action: str  # move|drop|reopen
    reason: str | None
    created_at: datetime


class DealDetail(DealOut):
    drop_reason: str | None
    closed_at: datetime | None
    created_at: datetime
    events: list[DealEventOut]  # 최신 위
    can_delete: bool  # 등록한 사람(지우지 않은 활동이 붙기 전)·exec


class DealIn(BaseModel):
    kind: DealKind
    name: DealName
    org_id: uuid.UUID
    owner_id: uuid.UUID | None = None
    amount_krw: Amount | None = None
    target_date: date | None = None
    next_action: NextAction = ""
    next_action_due: date | None = None


class DealPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kind·org_id 는 못 바꾼다 — 보내면 422

    version: int | None = None  # 없거나 어긋나면 409
    name: DealName | None = None
    owner_id: uuid.UUID | None = None
    amount_krw: Amount | None = None
    target_date: date | None = None
    next_action: NextAction | None = None
    next_action_due: date | None = None
    stage: str | None = None


class DropIn(BaseModel):
    reason: str = ""
    version: int | None = None


class ReopenIn(BaseModel):
    version: int | None = None


class ActivityOut(BaseModel):
    id: uuid.UUID
    kind: str
    occurred_at: datetime
    org: Person
    deal: Person | None
    contacts: list[Person]  # 외부 참석자, 이름순. 개인정보를 지운 담당자는 name ""
    users: list[Person]  # 사내 참석자, 이름순
    author: Person
    body: str
    can_edit: bool  # 작성자 또는 exec — 요청자마다 서버가 판정


class ActivityIn(BaseModel):
    kind: ActivityKind
    occurred_at: AwareDatetime
    org_id: uuid.UUID
    deal_id: uuid.UUID | None = None
    contact_ids: Ids = []
    user_ids: Ids = []
    body: ActivityBody


class ActivityPatch(BaseModel):
    kind: ActivityKind | None = None
    occurred_at: AwareDatetime | None = None
    deal_id: uuid.UUID | Literal[""] | None = None  # null 이나 "" 는 안건 연결 해제
    contact_ids: Ids | None = None
    user_ids: Ids | None = None
    body: ActivityBody | None = None


class ImportRow(BaseModel):
    line: int  # 파일의 줄 번호(머리글이 1행, 빈 행을 거르기 전 번호)
    org_name: str
    contact_name: str
    status: Literal["ok", "skip", "error"]
    note: str


class ImportResult(BaseModel):
    rows: list[ImportRow]
    new_orgs: int
    new_contacts: int


# ── 공통 ───────────────────────────────────────────────────────────────────


def normalize_org_name(name: str) -> str:
    """중복·검색용 이름 — `(주)`·`㈜`·`주식회사`·공백을 빼고 소문자(프론트 normalizeOrgName 과 같다)."""
    return re.sub(r"\s+", "", re.sub(r"\(주\)|㈜|주식회사", "", name)).lower()


def _invalid(detail: str) -> NoReturn:
    raise ApiError(422, "VALIDATION", detail)


def _not_found(what: str) -> NoReturn:
    raise ApiError(404, "NOT_FOUND", f"{what} 찾을 수 없습니다.")


def _conflict(
    detail: str = "다른 사람이 먼저 고쳤습니다. 새로 불러온 내용을 확인해 주세요.",
) -> NoReturn:
    raise ApiError(409, "CONFLICT", detail)


def _no_nulls(changes: dict, *nullable: str) -> None:
    for key, value in changes.items():
        if (
            value is None and key not in nullable
        ):  # boards.py 와 같은 계약 — null 은 "지움" 이 아니라 422
            _invalid(f"{key} 는 null 일 수 없습니다.")


def _uuid_or_none(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def _deny(
    db: AsyncSession, request: Request, user: User, target_id: uuid.UUID | None, why: str
) -> NoReturn:
    audit.record(
        db,
        "acl.denied",
        request=request,
        actor_id=user.id,
        target_id=target_id,
        detail={"path": request.url.path, "reason": why, "role": user.role},
    )
    await db.commit()
    raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")


async def _alive_org(db: AsyncSession, org_id: uuid.UUID, *, share: bool = False) -> CrmOrg | None:
    stmt = select(CrmOrg).where(CrmOrg.id == org_id, CrmOrg.deleted_at.is_(None))
    if share:  # 기관 삭제(FOR UPDATE)와 줄을 세운다 — 지워지는 기관에 새 안건이 붙지 않게
        stmt = stmt.with_for_update(read=True)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _check_users(
    db: AsyncSession, ids: set[uuid.UUID], detail: str, *, active: bool = True
) -> None:
    if not ids:
        return
    stmt = select(func.count()).select_from(User).where(User.id.in_(ids))
    if active:
        stmt = stmt.where(User.active.is_(True))
    if (await db.execute(stmt)).scalar_one() != len(ids):
        _invalid(detail)


# ── 기관 ───────────────────────────────────────────────────────────────────

# 목록 집계 — 기관마다 따로 세지 않고(N+1) 한 번에 묶어 붙인다
_CONTACT_COUNT = (
    select(CrmContact.org_id, func.count().label("n"))
    .where(CrmContact.erased.is_(False), CrmContact.deleted_at.is_(None))
    .group_by(CrmContact.org_id)
    .subquery()
)
_LAST_CONTACTED = (
    select(CrmActivity.org_id, func.max(CrmActivity.occurred_at).label("at"))
    .where(CrmActivity.deleted_at.is_(None))
    .group_by(CrmActivity.org_id)
    .subquery()
)


async def _org_items(db: AsyncSession, *where) -> list[tuple[CrmOrg, OrgItem]]:
    rows = (
        await db.execute(
            select(CrmOrg, func.coalesce(_CONTACT_COUNT.c.n, 0), _LAST_CONTACTED.c.at)
            .outerjoin(_CONTACT_COUNT, _CONTACT_COUNT.c.org_id == CrmOrg.id)
            .outerjoin(_LAST_CONTACTED, _LAST_CONTACTED.c.org_id == CrmOrg.id)
            .where(CrmOrg.deleted_at.is_(None), *where)
        )
    ).all()
    owners: dict[uuid.UUID, list[Person]] = defaultdict(list)
    if rows:
        for org_id, uid, name in await db.execute(
            select(CrmOrgOwner.org_id, User.id, User.name)
            .join(User, User.id == CrmOrgOwner.user_id)
            .where(CrmOrgOwner.org_id.in_([o.id for o, _, _ in rows]))
            .order_by(User.name, User.id)
        ):
            owners[org_id].append(Person(id=uid, name=name))
    rows.sort(key=lambda r: (r[0].name_norm, r[0].name, r[0].id))
    return [
        (
            org,
            OrgItem(
                id=org.id,
                name=org.name,
                org_type=org.org_type,
                owners=owners[org.id],
                contact_count=count,
                last_contacted_at=last,
            ),
        )
        for org, count, last in rows
    ]


def _in_alive_activity(contact_ids):
    """지우지 않은 활동의 참석자인 담당자 — 등록한 사람도 이때부터는 못 지운다."""
    return (
        select(CrmActivityContact.contact_id)
        .join(CrmActivity, CrmActivity.id == CrmActivityContact.activity_id)
        .where(CrmActivityContact.contact_id.in_(contact_ids), CrmActivity.deleted_at.is_(None))
    )


def _can_delete_contact(user: User, contact: CrmContact, used: bool) -> bool:
    # 등록한 사람은 활동에 붙기 전까지(잘못 넣은 사람을 치우는 길), exec 는 언제나
    return user.role == "exec" or (contact.created_by == user.id and not used)


async def _contacts_out(
    db: AsyncSession, user: User, contacts: list[CrmContact]
) -> list[ContactOut]:
    moves: dict[uuid.UUID, list[Move]] = defaultdict(list)
    used: set[uuid.UUID] = set()
    if contacts:
        used = set((await db.execute(_in_alive_activity([c.id for c in contacts]))).scalars())
        # 옮겨 오기 전 기관이 지워졌어도 이력은 남긴다 — 이름은 지우기 전 것
        for move, from_name in await db.execute(
            select(CrmContactMove, CrmOrg.name)
            .join(CrmOrg, CrmOrg.id == CrmContactMove.from_org_id)
            .where(CrmContactMove.contact_id.in_([c.id for c in contacts]))
            .order_by(CrmContactMove.moved_at.desc())
        ):
            moves[move.contact_id].append(
                Move(from_=Person(id=move.from_org_id, name=from_name), moved_at=move.moved_at)
            )
    return [
        ContactOut(
            id=c.id,
            org_id=c.org_id,
            name=c.name,
            title=c.title,
            phone=c.phone,
            email=c.email,
            memo=c.memo,
            erased=c.erased,
            can_delete=_can_delete_contact(user, c, c.id in used),
            moves=moves[c.id],
        )
        for c in contacts
    ]


async def _org_detail(db: AsyncSession, user: User, org_id: uuid.UUID) -> OrgDetail:
    rows = await _org_items(db, CrmOrg.id == org_id)
    if not rows:
        _not_found("기관을")
    org, item = rows[0]
    contacts = (
        (
            await db.execute(
                select(CrmContact)
                .where(CrmContact.org_id == org.id, CrmContact.deleted_at.is_(None))
                .order_by(CrmContact.created_at, CrmContact.id)
            )
        )
        .scalars()
        .all()
    )
    return OrgDetail(
        **item.model_dump(),
        memo=org.memo,
        contacts=await _contacts_out(db, user, list(contacts)),
        created_at=org.created_at,
    )


OWNER_INACTIVE = "사내 창구는 재직 중인 사람만 지정할 수 있습니다."


@router.get(
    "/orgs",
    response_model=Page[OrgItem],
    summary="기관 목록 — q(정규화 이름 부분일치)·type·owner·stale_days, 정규화 이름 한글순",
)
async def list_orgs(
    q: str = "",
    type_: str = Query("", alias="type"),
    owner: str = "",
    stale_days: int | None = Query(None, le=36500),
    db: AsyncSession = Depends(get_db),
) -> Page[OrgItem]:
    where = []
    if norm := normalize_org_name(q):
        where.append(CrmOrg.name_norm.contains(norm, autoescape=True))
    if type_:
        where.append(CrmOrg.org_type == type_)  # 모르는 값은 0건
    if owner:
        owner_id = _uuid_or_none(owner)
        if owner_id is None:
            return Page(items=[])
        where.append(
            CrmOrg.id.in_(select(CrmOrgOwner.org_id).where(CrmOrgOwner.user_id == owner_id))
        )
    if stale_days and stale_days > 0:  # 마지막 연락이 N일보다 오래됐거나 한 번도 없는 기관
        cutoff = datetime.now(UTC) - timedelta(days=stale_days)
        where.append(or_(_LAST_CONTACTED.c.at.is_(None), _LAST_CONTACTED.c.at < cutoff))
    return Page(items=[item for _, item in await _org_items(db, *where)])


@router.post(
    "/orgs",
    status_code=201,
    response_model=OrgCreated,
    summary="기관 등록 — 정규화 이름이 같은 기관이 있어도 만들고 duplicates 로 알린다",
)
async def create_org(
    body: OrgIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> OrgCreated:
    owners = set(body.owner_ids)
    await _check_users(db, owners, OWNER_INACTIVE)
    norm = normalize_org_name(body.name)
    duplicates = (
        await db.execute(
            select(CrmOrg.id, CrmOrg.name)
            .where(CrmOrg.name_norm == norm, CrmOrg.deleted_at.is_(None))
            .order_by(CrmOrg.created_at)
        )
    ).all()
    org = CrmOrg(name=body.name, name_norm=norm, org_type=body.org_type, memo=body.memo)
    db.add(org)
    await db.flush()
    db.add_all(CrmOrgOwner(org_id=org.id, user_id=uid) for uid in owners)
    await db.commit()
    return OrgCreated(
        org=await _org_detail(db, user, org.id),
        duplicates=[Person(id=i, name=n) for i, n in duplicates],
    )


@router.post(
    "/orgs/import",
    response_model=ImportResult,
    summary="CSV 가져오기(multipart file) — dry_run=true 면 판정만. 행별 ok·skip·error, 부분 반영",
)
async def import_orgs(
    request: Request,
    file: UploadFile | None = None,
    dry_run: str = "",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportResult:
    if file is None:
        _invalid("CSV 파일을 올려 주세요.")
    data = await file.read(IMPORT_MAX_BYTES + 1)
    if len(data) > IMPORT_MAX_BYTES:
        _invalid("파일은 1MB 까지 올릴 수 있습니다.")
    preview = dry_run == "true"
    result = await _import(db, user, _parse_csv(data), preview)
    if not preview:
        audit.record(
            db,
            "crm.imported",
            request=request,
            actor_id=user.id,
            detail={"orgs": result.new_orgs, "contacts": result.new_contacts},
        )
        await db.commit()
    return result


@router.get(
    "/orgs/deleted",
    response_model=Page[DeletedOrg],
    summary="지운 기관 목록 — exec 만, 최근에 지운 것부터. duplicate 는 그사이 생긴 같은 이름의 기관",
)
async def list_deleted_orgs(
    request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Page[DeletedOrg]:
    if user.role != "exec":
        await _deny(db, request, user, None, "org_deleted_list")
    gone = (
        await db.execute(
            select(CrmOrg)
            .where(CrmOrg.deleted_at.is_not(None))
            .order_by(CrmOrg.deleted_at.desc(), CrmOrg.id)
        )
    ).scalars()
    twins: dict[str, Person] = {}
    for oid, name, norm in await db.execute(
        select(CrmOrg.id, CrmOrg.name, CrmOrg.name_norm)
        .where(CrmOrg.deleted_at.is_(None))
        .order_by(CrmOrg.created_at.desc())
    ):
        twins[norm] = Person(id=oid, name=name)  # 같은 이름이 여럿이면 가장 먼저 만든 기관
    return Page(
        items=[
            DeletedOrg(
                id=o.id,
                name=o.name,
                org_type=o.org_type,
                deleted_at=o.deleted_at,
                reason=o.deleted_reason or "",
                duplicate=twins.get(o.name_norm),
            )
            for o in gone
        ]
    )


@router.post(
    "/orgs/{id}/restore",
    response_model=OrgDetail,
    summary="지운 기관 되살리기 — exec 만. 담당자·안건·활동이 그대로 돌아온다. 같은 이름 기관이 있어도 막지 않는다",
)
async def restore_org(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> OrgDetail:
    if user.role != "exec":
        await _deny(db, request, user, id, "org_restore")
    org = (
        await db.execute(
            select(CrmOrg).where(CrmOrg.id == id, CrmOrg.deleted_at.is_not(None)).with_for_update()
        )
    ).scalar_one_or_none()
    if org is None:
        _not_found("지운 기관을")
    org.deleted_at = None
    org.deleted_reason = None
    audit.record(
        db,
        "crm.org_restored",
        request=request,
        actor_id=user.id,
        target_id=org.id,
        detail={"name": org.name},
    )
    await db.commit()
    return await _org_detail(db, user, org.id)


@router.get("/orgs/{id}", response_model=OrgDetail, summary="기관 상세 — 지운 기관은 404")
async def get_org(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> OrgDetail:
    return await _org_detail(db, user, id)


@router.patch("/orgs/{id}", response_model=OrgDetail, summary="기관 수정 — 보낸 칸만, 누구나")
async def update_org(
    id: uuid.UUID,
    body: OrgPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> OrgDetail:
    org = await _alive_org(db, id)
    if org is None:
        _not_found("기관을")
    changes = body.model_dump(exclude_unset=True)
    _no_nulls(changes)
    if body.owner_ids is not None:
        new = set(body.owner_ids)
        current = set(
            (
                await db.execute(select(CrmOrgOwner.user_id).where(CrmOrgOwner.org_id == org.id))
            ).scalars()
        )
        # 새로 앉히는 사람만 재직 여부를 본다 — 이미 앉아 있던 퇴사자까지 막으면 메모 한 줄도 못 고친다
        await _check_users(db, new - current, OWNER_INACTIVE)
        await db.execute(
            delete(CrmOrgOwner).where(CrmOrgOwner.org_id == org.id, CrmOrgOwner.user_id.not_in(new))
        )
        db.add_all(CrmOrgOwner(org_id=org.id, user_id=uid) for uid in new - current)
    if body.name is not None:
        org.name = body.name
        org.name_norm = normalize_org_name(body.name)
    if body.org_type is not None:
        org.org_type = body.org_type
    if body.memo is not None:
        org.memo = body.memo
    await db.commit()
    return await _org_detail(db, user, org.id)


@router.delete(
    "/orgs/{id}",
    status_code=204,
    responses={409: {"description": "진행 중(open) 안건이 남은 기관"}},
    summary="기관 삭제(soft) — exec 만, 본문 {reason} 필수. 진행 중 안건이 있으면 409",
)
async def delete_org(
    id: uuid.UUID,
    request: Request,
    body: OrgDeleteIn | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if user.role != "exec":
        await _deny(db, request, user, id, "org_delete")
    org = (
        await db.execute(
            select(CrmOrg).where(CrmOrg.id == id, CrmOrg.deleted_at.is_(None)).with_for_update()
        )
    ).scalar_one_or_none()
    if org is None:
        _not_found("기관을")
    reason = (body.reason if body else "").strip()
    if not reason or len(reason) > REASON_MAX:
        _invalid(f"사유를 1자 이상 {REASON_MAX}자 이하로 적어 주세요.")
    # 안건 행도 잠근다 — 판정과 삭제 사이에 재개·단계 되돌리기(_lock_deal)가 끼면 지운 기관에 진행 중 안건이 남는다
    statuses = (
        (
            await db.execute(
                select(CrmDeal.status)
                .where(CrmDeal.org_id == org.id, CrmDeal.deleted_at.is_(None))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if open_count := statuses.count("open"):
        _conflict(f"진행 중 안건 {open_count}건을 먼저 중단하거나 끝내야 지울 수 있습니다.")
    org.deleted_at = datetime.now(UTC)
    org.deleted_reason = reason
    audit.record(  # 삭제 창이 「사유는 감사 기록에 남습니다」라고 약속한다
        db,
        "crm.org_deleted",
        request=request,
        actor_id=user.id,
        target_id=org.id,
        detail={"name": org.name, "reason": reason},
    )
    await db.commit()
    return Response(status_code=204)


# ── 담당자 ─────────────────────────────────────────────────────────────────


@router.post("/contacts", status_code=201, response_model=ContactOut, summary="담당자 등록")
async def create_contact(
    body: ContactIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ContactOut:
    if await _alive_org(db, body.org_id) is None:
        _invalid("기관을 먼저 골라 주세요.")
    contact = CrmContact(**body.model_dump(), created_by=user.id)
    db.add(contact)
    await db.commit()
    return (await _contacts_out(db, user, [contact]))[0]


async def _alive_contact(db: AsyncSession, contact_id: uuid.UUID) -> CrmContact:
    """목록에서 지우지 않았고 기관도 살아 있는 담당자를 잠가 읽는다 — 아니면 404(조회와 같은 기준)."""
    contact = (
        await db.execute(
            select(CrmContact)
            .where(CrmContact.id == contact_id, CrmContact.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if contact is None or await _alive_org(db, contact.org_id) is None:
        _not_found("담당자를")
    return contact


@router.patch(
    "/contacts/{id}",
    response_model=ContactOut,
    responses={409: {"description": "개인정보를 지운 담당자"}},
    summary="담당자 수정 — org_id 가 지금과 다르면 이직(이력을 남긴다). 옛 활동은 옛 기관에 남는다",
)
async def update_contact(
    id: uuid.UUID,
    body: ContactPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    contact = await _alive_contact(db, id)
    if contact.erased:
        _conflict("개인정보가 삭제된 담당자는 고칠 수 없습니다.")
    changes = body.model_dump(exclude_unset=True)
    _no_nulls(changes)
    org_id = changes.pop("org_id", contact.org_id)
    if org_id != contact.org_id:
        if await _alive_org(db, org_id) is None:
            _invalid("옮겨 갈 기관을 찾을 수 없습니다.")
        db.add(
            CrmContactMove(
                contact_id=contact.id,
                from_org_id=contact.org_id,
                to_org_id=org_id,
                moved_at=datetime.now(UTC),
            )
        )
        contact.org_id = org_id
    for key, value in changes.items():
        setattr(contact, key, value)
    await db.commit()
    return (await _contacts_out(db, user, [contact]))[0]


@router.delete(
    "/contacts/{id}",
    status_code=204,
    summary="담당자 지우기(목록에서 뺌) — 등록한 사람(지우지 않은 활동에 붙기 전)·exec. 활동 참석자 이름은 남는다",
)
async def delete_contact(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    contact = await _alive_contact(db, id)
    used = (await db.execute(_in_alive_activity([contact.id]).limit(1))).first() is not None
    if not _can_delete_contact(user, contact, used):
        await _deny(db, request, user, contact.id, "contact_delete")
    contact.deleted_at = datetime.now(UTC)
    # 이름은 남기지 않는다(개인정보 삭제와 같은 이유) — 행에 그대로 있다
    audit.record(db, "crm.contact_deleted", request=request, actor_id=user.id, target_id=contact.id)
    await db.commit()
    return Response(status_code=204)


@router.post(
    "/contacts/{id}/erase",
    response_model=ContactOut,
    summary="담당자 개인정보 삭제 — exec 만. 행은 남기고 이름·연락처·메모를 비운다(멱등)",
)
async def erase_contact(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    if user.role != "exec":
        await _deny(db, request, user, id, "contact_erase")
    contact = (
        await db.execute(select(CrmContact).where(CrmContact.id == id).with_for_update())
    ).scalar_one_or_none()
    if contact is None:
        _not_found("담당자를")
    contact.name = contact.title = contact.phone = contact.email = contact.memo = ""
    contact.erased = True
    # 지운 사람의 이름은 남기지 않는다 — 남기면 개인정보 삭제가 아니다
    audit.record(db, "crm.contact_erased", request=request, actor_id=user.id, target_id=contact.id)
    await db.commit()
    return (await _contacts_out(db, user, [contact]))[0]


# ── 안건 ───────────────────────────────────────────────────────────────────

_DEALS = (
    select(CrmDeal, CrmOrg.name, User)
    .join(CrmOrg, CrmOrg.id == CrmDeal.org_id)
    .outerjoin(User, User.id == CrmDeal.owner_id)
    .where(CrmOrg.deleted_at.is_(None), CrmDeal.deleted_at.is_(None))
)


def _deal_fields(deal: CrmDeal, org_name: str, owner: User | None) -> dict:
    return {
        "id": deal.id,
        "kind": deal.kind,
        "name": deal.name,
        "org": Person(id=deal.org_id, name=org_name),
        "owner": Person.model_validate(owner) if owner else None,
        "stage": deal.stage,
        "amount_krw": deal.amount_krw,
        "target_date": deal.target_date,
        "next_action": deal.next_action,
        "next_action_due": deal.next_action_due,
        "status": deal.status,
        "version": deal.version,
    }


async def _deal_used(db: AsyncSession, deal_id: uuid.UUID) -> bool:
    """지우지 않은 활동이 붙은 안건 — 등록한 사람도 이때부터는 못 지운다."""
    stmt = select(CrmActivity.id).where(
        CrmActivity.deal_id == deal_id, CrmActivity.deleted_at.is_(None)
    )
    return (await db.execute(stmt.limit(1))).first() is not None


def _can_delete_deal(user: User, creator_id: uuid.UUID | None, used: bool) -> bool:
    # 등록한 사람 = 등록 이력(from_stage NULL 인 move)의 주인. exec 는 언제나
    return user.role == "exec" or (creator_id == user.id and not used)


async def _deal_detail(db: AsyncSession, user: User, deal_id: uuid.UUID) -> DealDetail:
    row = (await db.execute(_DEALS.where(CrmDeal.id == deal_id))).first()
    if row is None:
        _not_found("안건을")
    deal, org_name, owner = row
    events = (
        await db.execute(
            select(CrmDealEvent, User)
            .join(User, User.id == CrmDealEvent.actor_id)
            .where(CrmDealEvent.deal_id == deal.id)
            .order_by(CrmDealEvent.created_at.desc(), CrmDealEvent.id)
        )
    ).all()
    creator = next((e.actor_id for e, _ in reversed(events) if e.from_stage is None), None)
    return DealDetail(
        **_deal_fields(deal, org_name, owner),
        drop_reason=deal.drop_reason,
        closed_at=deal.closed_at,
        created_at=deal.created_at,
        events=[
            DealEventOut(
                id=e.id,
                actor=Person.model_validate(actor),
                from_stage=e.from_stage,
                to_stage=e.to_stage,
                action=e.action,
                reason=e.reason,
                created_at=e.created_at,
            )
            for e, actor in events
        ],
        can_delete=_can_delete_deal(user, creator, await _deal_used(db, deal.id)),
    )


async def _lock_deal(db: AsyncSession, deal_id: uuid.UUID) -> CrmDeal:
    deal = (
        await db.execute(
            select(CrmDeal)
            .where(CrmDeal.id == deal_id, CrmDeal.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    # 잠근 뒤 새 문장으로 기관을 본다 — 기관 삭제가 이 안건을 잠그고 있었다면 그 결과(deleted_at)가 보인다
    if deal is None or await _alive_org(db, deal.org_id) is None:
        _not_found("안건을")
    return deal


def _event(deal: CrmDeal, user: User, now: datetime, action: str, **kw) -> CrmDealEvent:
    # created_at 은 앱 시각(마이크로초) — 같은 안건의 이력 순서가 이것 하나로 정해진다
    return CrmDealEvent(deal_id=deal.id, actor_id=user.id, action=action, created_at=now, **kw)


def _check_due(next_action: str, due: date | None) -> None:
    """할 일 없이 기한만 있으면 카드에 기한만 덩그러니 뜬다."""
    if not next_action.strip() and due is not None:
        _invalid("다음 할 일을 적어야 기한을 둘 수 있습니다.")


OWNER_INACTIVE_DEAL = "담당자는 재직 중인 사람만 지정할 수 있습니다."


@router.get(
    "/deals",
    response_model=Page[DealOut],
    summary="안건 목록 — kind·status·org_id 정확 일치, 등록 최신순. 지운 기관의 안건은 빠진다",
)
async def list_deals(
    kind: str = "", status: str = "", org_id: str = "", db: AsyncSession = Depends(get_db)
) -> Page[DealOut]:
    stmt = _DEALS.order_by(CrmDeal.created_at.desc(), CrmDeal.id)
    if kind:
        stmt = stmt.where(CrmDeal.kind == kind)
    if status:
        stmt = stmt.where(CrmDeal.status == status)
    if org_id:
        oid = _uuid_or_none(org_id)
        if oid is None:
            return Page(items=[])
        stmt = stmt.where(CrmDeal.org_id == oid)
    return Page(items=[DealOut(**_deal_fields(*row)) for row in await db.execute(stmt)])


@router.post(
    "/deals",
    status_code=201,
    response_model=DealDetail,
    summary="안건 등록 — 종류의 첫 단계·open·version 1, 이력 1건",
)
async def create_deal(
    body: DealIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DealDetail:
    if await _alive_org(db, body.org_id, share=True) is None:
        _invalid("기관을 골라 주세요.")
    if body.owner_id:
        await _check_users(db, {body.owner_id}, OWNER_INACTIVE_DEAL)
    _check_due(body.next_action, body.next_action_due)
    now = datetime.now(UTC)
    first = STAGES[body.kind][0][0]
    deal = CrmDeal(**body.model_dump(), stage=first, status="open", version=1, created_at=now)
    db.add(deal)
    await db.flush()
    db.add(_event(deal, user, now, "move", from_stage=None, to_stage=first))
    await db.commit()
    return await _deal_detail(db, user, deal.id)


@router.get("/deals/{id}", response_model=DealDetail, summary="안건 상세 — 이력 최신 위")
async def get_deal(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DealDetail:
    return await _deal_detail(db, user, id)


@router.delete(
    "/deals/{id}",
    status_code=204,
    summary="안건 지우기(목록에서 뺌) — 등록한 사람(지우지 않은 활동이 붙기 전)·exec. 이력·활동은 남는다",
)
async def delete_deal(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    deal = await _lock_deal(db, id)
    creator = (
        await db.execute(
            select(CrmDealEvent.actor_id)
            .where(CrmDealEvent.deal_id == deal.id, CrmDealEvent.from_stage.is_(None))
            .order_by(CrmDealEvent.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if not _can_delete_deal(user, creator, await _deal_used(db, deal.id)):
        await _deny(db, request, user, deal.id, "deal_delete")
    deal.deleted_at = datetime.now(UTC)
    audit.record(  # 지운 뒤에는 찾을 수 없으니 감사 화면이 알아보게 이름을 남긴다
        db,
        "crm.deal_deleted",
        request=request,
        actor_id=user.id,
        target_id=deal.id,
        detail={"name": deal.name},
    )
    await db.commit()
    return Response(status_code=204)


@router.patch(
    "/deals/{id}",
    response_model=DealDetail,
    responses={409: {"description": "version 어긋남(누락 포함)·끝난 안건의 단계 이동"}},
    summary="안건 수정·단계 이동 — version 필수. 마지막 단계면 won, 성사 되돌리기는 exec 만",
)
async def update_deal(
    id: uuid.UUID,
    body: DealPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> DealDetail:
    deal = await _lock_deal(db, id)
    if body.version is None or body.version != deal.version:
        _conflict()
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    _no_nulls(changes, "owner_id", "amount_krw", "target_date", "next_action_due")
    if changes.get("owner_id") and changes["owner_id"] != deal.owner_id:
        await _check_users(db, {changes["owner_id"]}, OWNER_INACTIVE_DEAL)
    # 할 일·기한을 건드리는 요청만 합친 값으로 본다 — 단계만 옮기는 요청이 옛 데이터 때문에 막히지 않게
    if "next_action" in changes or "next_action_due" in changes:
        _check_due(
            changes.get("next_action", deal.next_action),
            changes.get("next_action_due", deal.next_action_due),
        )
    now = datetime.now(UTC)
    stage = changes.pop("stage", deal.stage)
    if stage != deal.stage:
        # 성사는 임원만 되돌린다(15 §6). 중단은 재개(reopen)로 연다
        if deal.status != "open" and not (deal.status == "won" and user.role == "exec"):
            _conflict("끝난 안건은 단계를 옮길 수 없습니다.")
        keys = [key for key, _ in STAGES[deal.kind]]
        if stage not in keys:
            _invalid("단계가 올바르지 않습니다.")
        db.add(_event(deal, user, now, "move", from_stage=deal.stage, to_stage=stage))
        deal.stage = stage
        won = stage == keys[-1]
        deal.status = "won" if won else "open"
        deal.closed_at = now if won else None
    for key, value in changes.items():
        setattr(deal, key, value)
    deal.version += 1  # 칸이 안 바뀌어도 올린다
    await db.commit()
    return await _deal_detail(db, user, deal.id)


@router.post(
    "/deals/{id}/drop",
    response_model=DealDetail,
    responses={409: {"description": "version 어긋남·진행 중이 아닌 안건"}},
    summary="안건 중단 — {reason, version}. 진행 중(open)만",
)
async def drop_deal(
    id: uuid.UUID,
    body: DropIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> DealDetail:
    deal = await _lock_deal(db, id)
    reason = body.reason.strip()
    if not reason or len(reason) > REASON_MAX:
        _invalid(f"중단 사유를 1자 이상 {REASON_MAX}자 이하로 적어 주세요.")
    if body.version is None or body.version != deal.version:
        _conflict()
    if deal.status != "open":
        _conflict("진행 중인 안건만 중단할 수 있습니다.")
    now = datetime.now(UTC)
    deal.status = "dropped"
    deal.drop_reason = reason
    deal.closed_at = now
    deal.version += 1
    db.add(
        _event(deal, user, now, "drop", from_stage=deal.stage, to_stage=deal.stage, reason=reason)
    )
    await db.commit()
    return await _deal_detail(db, user, deal.id)


@router.post(
    "/deals/{id}/reopen",
    response_model=DealDetail,
    responses={409: {"description": "version 어긋남·중단되지 않은 안건"}},
    summary="안건 재개 — {version}. 중단(dropped)만. 성사는 exec 의 단계 이동으로 되돌린다",
)
async def reopen_deal(
    id: uuid.UUID,
    body: ReopenIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> DealDetail:
    deal = await _lock_deal(db, id)
    if body.version is None or body.version != deal.version:
        _conflict()
    if deal.status != "dropped":
        _conflict("중단된 안건만 재개할 수 있습니다.")
    deal.status = "open"
    deal.drop_reason = None
    deal.closed_at = None
    deal.version += 1
    db.add(
        _event(deal, user, datetime.now(UTC), "reopen", from_stage=deal.stage, to_stage=deal.stage)
    )
    await db.commit()
    return await _deal_detail(db, user, deal.id)


# ── 활동 ───────────────────────────────────────────────────────────────────

_ACTIVITIES = (
    select(CrmActivity, CrmOrg.name, CrmDeal.name, User)
    .join(CrmOrg, CrmOrg.id == CrmActivity.org_id)
    # 지운 안건은 붙이지 않는다 — 활동은 기관 타임라인에 남고 안건 표시만 빠진다
    .outerjoin(CrmDeal, and_(CrmDeal.id == CrmActivity.deal_id, CrmDeal.deleted_at.is_(None)))
    .join(User, User.id == CrmActivity.author_id)
    .where(CrmActivity.deleted_at.is_(None))
)


def _can_edit(user: User, activity: CrmActivity) -> bool:
    return activity.author_id == user.id or user.role == "exec"


async def _activities_out(db: AsyncSession, user: User, rows) -> list[ActivityOut]:
    ids = [a.id for a, *_ in rows]
    contacts: dict[uuid.UUID, list[Person]] = defaultdict(list)
    people: dict[uuid.UUID, list[Person]] = defaultdict(list)
    if ids:
        for aid, cid, name in await db.execute(
            select(CrmActivityContact.activity_id, CrmContact.id, CrmContact.name)
            .join(CrmContact, CrmContact.id == CrmActivityContact.contact_id)
            .where(CrmActivityContact.activity_id.in_(ids))
            .order_by(CrmContact.name, CrmContact.id)
        ):
            contacts[aid].append(Person(id=cid, name=name))
        for aid, uid, name in await db.execute(
            select(CrmActivityUser.activity_id, User.id, User.name)
            .join(User, User.id == CrmActivityUser.user_id)
            .where(CrmActivityUser.activity_id.in_(ids))
            .order_by(User.name, User.id)
        ):
            people[aid].append(Person(id=uid, name=name))
    return [
        ActivityOut(
            id=a.id,
            kind=a.kind,
            occurred_at=a.occurred_at,
            org=Person(id=a.org_id, name=org_name),
            deal=Person(id=a.deal_id, name=deal_name) if deal_name is not None else None,
            contacts=contacts[a.id],
            users=people[a.id],
            author=Person.model_validate(author),
            body=a.body,
            can_edit=_can_edit(user, a),
        )
        for a, org_name, deal_name, author in rows
    ]


async def _activity_out(db: AsyncSession, user: User, activity_id: uuid.UUID) -> ActivityOut:
    rows = (await db.execute(_ACTIVITIES.where(CrmActivity.id == activity_id))).all()
    return (await _activities_out(db, user, rows))[0]


def _check_when(at: datetime) -> None:
    # 미래 기록은 마지막 연락일을 앞당겨 「연락 없음」 필터를 속인다. 앞일은 안건의 다음 할 일에 적는다
    if at > datetime.now(UTC) + FUTURE_SLACK:
        _invalid("앞으로의 일시는 기록할 수 없습니다.")


async def _check_contacts(db: AsyncSession, org_id: uuid.UUID, ids: set[uuid.UUID]) -> None:
    """외부 참석자는 그 기관 소속 담당자만 — 다른 기관 사람을 섞으면 타임라인이 거짓말을 한다.

    개인정보를 지웠거나 목록에서 지운 담당자는 새로 넣지 못한다(수정 때 이미 있던 참석자는 호출하는 쪽이 빼고 넘긴다)."""
    if not ids:
        return
    n = (
        await db.execute(
            select(func.count())
            .select_from(CrmContact)
            .where(
                CrmContact.id.in_(ids),
                CrmContact.org_id == org_id,
                CrmContact.erased.is_(False),
                CrmContact.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    if n != len(ids):
        _invalid("외부 참석자는 이 기관의 담당자여야 합니다.")


async def _check_deal(db: AsyncSession, org_id: uuid.UUID, deal_id: uuid.UUID | None) -> None:
    if deal_id is None:
        return
    deal = await db.get(CrmDeal, deal_id)
    if deal is None or deal.org_id != org_id or deal.deleted_at is not None:
        _invalid("이 기관의 안건이 아닙니다.")


def _attendees(
    activity_id: uuid.UUID, contact_ids: set[uuid.UUID] | None, user_ids: set[uuid.UUID] | None
) -> list:
    rows: list = []
    if contact_ids is not None:
        rows += [CrmActivityContact(activity_id=activity_id, contact_id=c) for c in contact_ids]
    if user_ids is not None:
        rows += [CrmActivityUser(activity_id=activity_id, user_id=u) for u in user_ids]
    return rows


USERS_INVALID = "사내 참석자가 올바르지 않습니다."


@router.get(
    "/activities",
    response_model=Page[ActivityOut],
    summary="활동 타임라인 — org_id 나 deal_id 하나 필수(둘 다면 org_id), occurred_at 최신순",
)
async def list_activities(
    org_id: uuid.UUID | None = None,
    deal_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Page[ActivityOut]:
    if org_id is not None:
        if await _alive_org(db, org_id) is None:
            _not_found("기관을")
        cond = CrmActivity.org_id == org_id  # 안건에 건 기록도 기관 타임라인에 뜬다
    elif deal_id is not None:
        deal = await db.get(CrmDeal, deal_id)
        if deal is None or deal.deleted_at is not None or await _alive_org(db, deal.org_id) is None:
            _not_found("안건을")
        cond = CrmActivity.deal_id == deal_id
    else:
        _invalid("org_id 나 deal_id 가 필요합니다.")
    rows = (
        await db.execute(
            _ACTIVITIES.where(cond).order_by(CrmActivity.occurred_at.desc(), CrmActivity.id)
        )
    ).all()
    return Page(items=await _activities_out(db, user, rows))


@router.post("/activities", status_code=201, response_model=ActivityOut, summary="활동 기록")
async def create_activity(
    body: ActivityIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ActivityOut:
    if await _alive_org(db, body.org_id) is None:
        _invalid("기관을 골라 주세요.")
    _check_when(body.occurred_at)
    await _check_users(db, set(body.user_ids), USERS_INVALID, active=False)  # 계정 존재만(퇴사자도)
    await _check_contacts(db, body.org_id, set(body.contact_ids))
    await _check_deal(db, body.org_id, body.deal_id)
    activity = CrmActivity(
        kind=body.kind,
        occurred_at=body.occurred_at,
        org_id=body.org_id,
        deal_id=body.deal_id,
        author_id=user.id,
        body=body.body,
    )
    db.add(activity)
    await db.flush()
    db.add_all(_attendees(activity.id, set(body.contact_ids), set(body.user_ids)))
    await db.commit()
    return await _activity_out(db, user, activity.id)


async def _own_activity(
    db: AsyncSession, request: Request, user: User, activity_id: uuid.UUID, why: str
) -> CrmActivity:
    activity = (
        await db.execute(
            select(CrmActivity).where(
                CrmActivity.id == activity_id, CrmActivity.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    # 지운 기관의 활동은 타임라인(조회)과 같게 404
    if activity is None or await _alive_org(db, activity.org_id) is None:
        _not_found("활동 기록을")
    if not _can_edit(user, activity):
        await _deny(db, request, user, activity.id, why)
    return activity


@router.patch(
    "/activities/{id}",
    response_model=ActivityOut,
    summary="활동 수정 — 작성자·exec 만. 보낸 칸만, 기관은 못 바꾼다",
)
async def update_activity(
    id: uuid.UUID,
    body: ActivityPatch,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityOut:
    activity = await _own_activity(db, request, user, id, "activity_edit")
    changes = body.model_dump(exclude_unset=True)
    _no_nulls(changes, "deal_id")
    if "occurred_at" in changes:
        _check_when(changes["occurred_at"])
    contact_ids = set(changes["contact_ids"]) if "contact_ids" in changes else None
    user_ids = set(changes["user_ids"]) if "user_ids" in changes else None
    if user_ids is not None:
        await _check_users(db, user_ids, USERS_INVALID, active=False)
    if contact_ids is not None:
        current = set(
            (
                await db.execute(
                    select(CrmActivityContact.contact_id).where(
                        CrmActivityContact.activity_id == activity.id
                    )
                )
            ).scalars()
        )
        # 그사이 이직한 참석자는 이미 기록에 있던 사람이라 그대로 둔다. 새로 넣는 사람만 본다
        await _check_contacts(db, activity.org_id, contact_ids - current)
    deal_id = (changes["deal_id"] or None) if "deal_id" in changes else activity.deal_id
    # 바뀔 때만 본다 — 그사이 지운 안건에 걸려 있던 기록을 낡은 화면에서 고쳐도 막히지 않게
    if deal_id != activity.deal_id:
        await _check_deal(db, activity.org_id, deal_id)
    # 검사를 다 지난 뒤에만 고친다
    if contact_ids is not None:
        await db.execute(
            delete(CrmActivityContact).where(CrmActivityContact.activity_id == activity.id)
        )
    if user_ids is not None:
        await db.execute(delete(CrmActivityUser).where(CrmActivityUser.activity_id == activity.id))
    activity.deal_id = deal_id
    for key in ("kind", "occurred_at", "body"):
        if key in changes:
            setattr(activity, key, changes[key])
    db.add_all(_attendees(activity.id, contact_ids, user_ids))
    await db.commit()
    return await _activity_out(db, user, activity.id)


@router.delete("/activities/{id}", status_code=204, summary="활동 삭제(soft) — 작성자·exec 만")
async def delete_activity(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    activity = await _own_activity(db, request, user, id, "activity_delete")
    activity.deleted_at = datetime.now(UTC)
    audit.record(
        db, "crm.activity_deleted", request=request, actor_id=user.id, target_id=activity.id
    )
    await db.commit()
    return Response(status_code=204)


# ── 가져오기(CSV) ───────────────────────────────────────────────────────────


def _parse_csv(data: bytes) -> list[list[str]]:
    """UTF-8 엄격 → 안 되면 CP949(한글 윈도우 엑셀의 「CSV(쉼표로 분리)」). BOM 은 뗀다. RFC 4180."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("cp949", errors="replace")
    # BOM 을 떼고, NUL 은 버린다(Postgres text 가 받지 않는다)
    text = text.removeprefix("\ufeff").replace("\x00", "")
    try:
        # strict: 닫히지 않은 따옴표·닫는 따옴표 뒤의 글자를 오류로 — 칸이 밀린 채 반영되지 않게
        return list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error:  # 따옴표 짝·칸 길이 상한(field_size_limit) 등
        _invalid("CSV 형식이 잘못됐습니다(따옴표 짝·칸 길이). 엑셀에서 CSV 로 다시 저장해 주세요.")


def _row_error(org_name: str, name: str, cells: dict[str, str]) -> str | None:
    if not org_name or len(org_name) > 100:
        return "기관 이름은 1자 이상 100자 이하여야 합니다."
    if len(cells["memo"]) > 2000:
        return "메모는 2000자를 넘을 수 없습니다."
    if not name:
        return (
            "담당자 이름이 비었습니다."
            if cells["title"] or cells["phone"] or cells["email"]
            else None
        )
    if max(len(name), len(cells["title"]), len(cells["phone"]), len(cells["email"])) > 200:
        return "이름·부서·직함·전화·이메일은 200자를 넘을 수 없습니다."
    if cells["email"] and not EMAIL_RE.match(cells["email"]):
        return "이메일 형식이 아닙니다."
    return None


async def _import(
    db: AsyncSession, user: User, rows: list[list[str]], dry_run: bool
) -> ImportResult:
    """한 행이 담당자 한 명, 이름이 비면 기관만. 기관은 정규화 이름으로 기존 기관에 붙인다(중복 기관을 만들지 않는다).

    같은 기관에 같은 이름의 담당자가 있으면 건너뛴다(갱신 안 함). 실패 행은 사유와 함께 돌려주고 나머지는 반영한다.
    ponytail: 미리보기와 반영 사이에 누가 같은 기관·담당자를 만들어도 막지 않는다 — 반영 결과가 다시 판정한 값이다.
    """
    header, *rest = rows or [[]]
    col = {
        key: next((i for i, h in enumerate(header) if h.strip() == label), -1)
        for key, label in IMPORT_HEADERS.items()
    }
    if col["org"] < 0:
        _invalid("첫 줄에 「기관」 칸이 있어야 합니다.")
    # 줄 번호는 빈 행을 거르기 전에 매긴다 — 엑셀의 행 번호와 같게(머리글이 1행)
    body = [(cells, i + 2) for i, cells in enumerate(rest) if any(c.strip() for c in cells)]
    if not body:
        _invalid("가져올 행이 없습니다.")
    if len(body) > IMPORT_MAX_ROWS:
        _invalid(f"한 번에 {IMPORT_MAX_ROWS}행까지 올릴 수 있습니다.")

    # 정규화 이름 → (기관 id, 이름). 같은 정규화 이름이 여럿이면 가장 먼저 만든 기관에 붙인다
    known: dict[str, tuple[uuid.UUID, str]] = {}
    for oid, name, norm in await db.execute(
        select(CrmOrg.id, CrmOrg.name, CrmOrg.name_norm)
        .where(CrmOrg.deleted_at.is_(None))
        .order_by(CrmOrg.created_at.desc())
    ):
        known[norm] = (oid, name)
    seen = {
        (norm, name)
        for norm, name in await db.execute(
            select(CrmOrg.name_norm, CrmContact.name)
            .join(CrmOrg, CrmOrg.id == CrmContact.org_id)
            .where(
                CrmOrg.deleted_at.is_(None),
                CrmContact.erased.is_(False),
                CrmContact.deleted_at.is_(None),
            )
        )
    }

    result = ImportResult(rows=[], new_orgs=0, new_contacts=0)
    new_orgs: list[CrmOrg] = []
    new_contacts: list[CrmContact] = []
    for cells, line in body:
        get = {key: (cells[i].strip() if 0 <= i < len(cells) else "") for key, i in col.items()}
        org_name, name = get["org"], get["name"]
        row = ImportRow(line=line, org_name=org_name, contact_name=name, status="ok", note="")
        result.rows.append(row)
        org_type = TYPE_BY_LABEL.get(get["type"]) if get["type"] else "etc"
        error = (
            f"유형 「{get['type']}」 을 알 수 없습니다."
            if org_type is None
            else _row_error(org_name, name, get)
        )
        if error:
            row.status, row.note = "error", error
            continue
        norm = normalize_org_name(org_name)
        org = known.get(norm)
        if org is None:
            org = (uuid.uuid4(), org_name)  # id 를 앱이 정해 행마다 flush 하지 않는다
            if not dry_run:  # 기관만 있는 행(기관 내보내기 파일)의 메모는 새 기관의 메모로
                new_orgs.append(
                    CrmOrg(
                        id=org[0],
                        name=org_name,
                        name_norm=norm,
                        org_type=org_type,
                        memo="" if name else get["memo"],
                    )
                )
            known[norm] = org
            result.new_orgs += 1
            row.note = "새 기관"
        elif not name:
            row.status, row.note = "skip", "이미 있는 기관"
            continue
        elif org[1] != org_name:
            row.note = f"기존 기관 「{org[1]}」 에 붙임"
        if name:
            if (norm, name) in seen:
                row.status, row.note = "skip", "이미 있는 담당자"
                continue
            seen.add((norm, name))
            if not dry_run:
                new_contacts.append(
                    CrmContact(
                        org_id=org[0],
                        name=name,
                        title=get["title"],
                        phone=get["phone"],
                        email=get["email"],
                        memo=get["memo"],
                    )
                )
            result.new_contacts += 1
    if new_orgs or new_contacts:  # 되돌리기의 근거 — 만든 것이 없으면 남기지 않는다
        batch = CrmImport(id=uuid.uuid4(), user_id=user.id, created_at=datetime.now(UTC))
        db.add(batch)
        await db.flush()
        for row_ in (*new_orgs, *new_contacts):
            row_.import_id = batch.id
        for contact in new_contacts:
            contact.created_by = user.id
    # 관계(relationship)를 안 걸어 두어 작업 단위가 INSERT 순서를 모른다 — 기관을 먼저 넣는다(외래키)
    db.add_all(new_orgs)
    await db.flush()
    db.add_all(new_contacts)
    return result


# ── 가져오기 되돌리기 ───────────────────────────────────────────────────────
# 프론트(#315)가 정한 계약. 가져온 사람만, 24시간 안에. 그 가져오기로 만든 기관·담당자 중 아직 안 쓰인 것을 행째 지운다.

IMPORT_UNDO = timedelta(hours=24)  # 가져온 뒤 손으로 고친 칸까지 같이 지워지므로 길게 두지 않는다


@router.get(
    "/imports/last",
    response_model=LastImportOut,
    summary="내가 한 마지막 가져오기 — 되돌릴 것이 없거나 24시간이 지났으면 {import: null}",
)
async def last_import(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> LastImportOut:
    batch = (
        await db.execute(
            select(CrmImport)
            .where(CrmImport.user_id == user.id, CrmImport.undone_at.is_(None))
            .order_by(CrmImport.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if batch is None or datetime.now(UTC) - batch.created_at >= IMPORT_UNDO:
        return LastImportOut(import_=None)
    orgs = select(func.count()).select_from(CrmOrg).where(CrmOrg.import_id == batch.id)
    contacts = select(func.count()).select_from(CrmContact).where(CrmContact.import_id == batch.id)
    return LastImportOut(
        import_=LastImport(
            id=batch.id,
            created_at=batch.created_at,
            new_orgs=(await db.execute(orgs)).scalar_one(),
            new_contacts=(await db.execute(contacts)).scalar_one(),
        )
    )


async def _ids(db: AsyncSession, stmt) -> set[uuid.UUID]:
    return set((await db.execute(stmt)).scalars())


@router.post(
    "/imports/{id}/undo",
    response_model=ImportUndone,
    responses={409: {"description": "가져온 지 24시간이 지났다"}},
    summary="가져오기 되돌리기 — 가져온 사람만, 24시간 안에. 그사이 쓰이기 시작한 기관·담당자는 남긴다(kept_*)",
)
async def undo_import(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportUndone:
    """쓰이기 시작한 것: 기관 — 안건·활동·이직 이력이 있거나 다른 담당자가 있다(지운 안건·활동·담당자도 센다,
    아래 ponytail). 그 기관과 거기 가져온 담당자는 통째로 남긴다. 담당자 — 그 기관이 남거나, 개인정보를 지웠거나,
    이직했거나, 활동 참석자다. 목록에서 지운 행도 같은 판정으로 치우되 수에는 넣지 않는다(화면에 없던 것).

    ponytail: 지운 안건·활동·담당자가 가리키는 행은 외래키 때문에 행째 지울 수 없어 「쓰인 것」으로 남긴다(목은 지운다).
    판정과 DELETE 사이에 누가 그 담당자를 활동에 붙이면 외래키 위반 409 — 다시 누르면 남긴 쪽으로 판정된다.
    """
    batch = (
        await db.execute(
            select(CrmImport)
            .where(CrmImport.id == id, CrmImport.undone_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if batch is None:  # 되돌린 것도 404 — 두 번 눌러도 더 지우지 않는다
        _not_found("가져오기를")
    if batch.user_id != user.id:
        await _deny(db, request, user, batch.id, "import_undo")
    now = datetime.now(UTC)
    if now - batch.created_at >= IMPORT_UNDO:
        _conflict("가져온 지 24시간이 지나 되돌릴 수 없습니다.")

    orgs = list((await db.execute(select(CrmOrg).where(CrmOrg.import_id == batch.id))).scalars())
    contacts = list(
        (await db.execute(select(CrmContact).where(CrmContact.import_id == batch.id))).scalars()
    )
    org_ids = [o.id for o in orgs]
    mine = [c.id for c in contacts]
    busy: set[uuid.UUID] = set()
    if org_ids:
        busy |= await _ids(db, select(CrmDeal.org_id).where(CrmDeal.org_id.in_(org_ids)))
        busy |= await _ids(db, select(CrmActivity.org_id).where(CrmActivity.org_id.in_(org_ids)))
        busy |= await _ids(
            db,
            select(CrmContactMove.from_org_id).where(CrmContactMove.from_org_id.in_(org_ids)),
        )
        busy |= await _ids(
            db, select(CrmContactMove.to_org_id).where(CrmContactMove.to_org_id.in_(org_ids))
        )
        busy |= await _ids(
            db,
            select(CrmContact.org_id).where(
                CrmContact.org_id.in_(org_ids), CrmContact.id.not_in(mine)
            ),
        )
    used: set[uuid.UUID] = set()
    if mine:
        used |= await _ids(
            db, select(CrmContactMove.contact_id).where(CrmContactMove.contact_id.in_(mine))
        )
        used |= await _ids(
            db,
            select(CrmActivityContact.contact_id).where(CrmActivityContact.contact_id.in_(mine)),
        )

    done = ImportUndone(removed_orgs=0, removed_contacts=0, kept_orgs=0, kept_contacts=0)
    kept_orgs = set(busy)
    removed_contacts = []
    for c in contacts:
        keep = c.org_id in busy or c.erased or c.id in used
        if keep:
            kept_orgs.add(c.org_id)  # 남긴 담당자가 있는 기관도 남긴다
        else:
            removed_contacts.append(c.id)
        if c.deleted_at is None:
            if keep:
                done.kept_contacts += 1
            else:
                done.removed_contacts += 1
    removed_orgs = [o.id for o in orgs if o.id not in kept_orgs]
    for o in orgs:
        if o.deleted_at is None:
            if o.id in kept_orgs:
                done.kept_orgs += 1
            else:
                done.removed_orgs += 1
    if removed_contacts:
        await db.execute(delete(CrmContact).where(CrmContact.id.in_(removed_contacts)))
    if removed_orgs:
        await db.execute(delete(CrmOrgOwner).where(CrmOrgOwner.org_id.in_(removed_orgs)))
        await db.execute(delete(CrmOrg).where(CrmOrg.id.in_(removed_orgs)))
    batch.undone_at = now
    audit.record(
        db, "crm.import_undone", request=request, actor_id=user.id, detail=done.model_dump()
    )
    await db.commit()
    return done


# ── 내보내기(xlsx) ──────────────────────────────────────────────────────────


def _day(at: datetime | None) -> str:
    return at.astimezone(KST).date().isoformat() if at else ""


def _xlsx(sheet: str, header: list[str], rows: list[list], int_col: int | None = None) -> bytes:
    """시트 1장, 머리글 굵게·머리글 행과 첫 열 고정. 셀은 글자·숫자뿐 — 수식으로 저장되는 칸을 두지 않는다."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(header)
    for row in rows:
        # 제어 문자는 openpyxl 이 거부한다(500). 메모에 들어올 수 있어 뺀다
        ws.append([ILLEGAL_CHARACTERS_RE.sub("", v) if isinstance(v, str) else v for v in row])
    for cells in ws.iter_rows(min_row=2):
        for cell in cells:
            if cell.data_type == "f":  # "=" 로 시작하는 글자 — 수식이 아니라 글자로 (수식 주입)
                cell.data_type = "s"
            if int_col is not None and cell.column == int_col + 1:
                cell.number_format = "#,##0"
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.freeze_panes = "B2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.post(
    "/export",
    response_class=Response,
    responses={
        200: {"content": {XLSX: {}}, "description": "xlsx 시트 1장(파일명은 프론트가 정한다)"}
    },
    summary="내보내기 entity=orgs|contacts|deals → xlsx. 감사 crm.exported (POST — 감사·CSRF)",
)
async def export(
    request: Request,
    entity: str = "",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    int_col = None
    if entity == "orgs":
        sheet = "기관"
        header = ["기관", "유형", "사내 창구", "담당자 수", "마지막 연락", "메모", "등록일"]
        rows = [
            [
                item.name,
                ORG_TYPE_LABEL.get(org.org_type, org.org_type),
                ", ".join(p.name for p in item.owners),
                item.contact_count,  # 담당자 시트와 같은 기준 — 개인정보를 지운 사람은 빠진다
                _day(item.last_contacted_at),
                org.memo,
                _day(org.created_at),
            ]
            for org, item in await _org_items(db)
        ]
    elif entity == "contacts":
        sheet = "담당자"
        header = ["기관", "이름", "부서·직함", "전화", "이메일", "메모"]
        found = (
            await db.execute(
                select(CrmContact, CrmOrg.name, CrmOrg.name_norm)
                .join(CrmOrg, CrmOrg.id == CrmContact.org_id)
                .where(
                    CrmOrg.deleted_at.is_(None),
                    CrmContact.erased.is_(False),
                    CrmContact.deleted_at.is_(None),
                )
            )
        ).all()
        found.sort(key=lambda r: (r[2], r[0].name, r[0].id))
        rows = [[org_name, c.name, c.title, c.phone, c.email, c.memo] for c, org_name, _ in found]
    elif entity == "deals":
        sheet = "안건"
        header = [
            "종류",
            "안건",
            "기관",
            "단계",
            "상태",
            "금액(원)",
            "사내 담당자",
            "목표일",
            "다음 할 일",
            "기한",
            "중단 사유",
            "등록일",
        ]
        int_col = header.index("금액(원)")
        rows = [
            [
                DEAL_KIND_LABEL.get(d.kind, d.kind),
                d.name,
                org_name,
                dict(STAGES.get(d.kind, [])).get(d.stage, d.stage),
                DEAL_STATUS_LABEL.get(d.status, d.status),
                d.amount_krw if d.amount_krw is not None else "",
                owner.name if owner else "",
                d.target_date.isoformat() if d.target_date else "",
                d.next_action,
                d.next_action_due.isoformat() if d.next_action_due else "",
                d.drop_reason or "",
                _day(d.created_at),
            ]
            for d, org_name, owner in await db.execute(
                _DEALS.order_by(CrmDeal.created_at.desc(), CrmDeal.id)
            )
        ]
    else:
        _invalid("entity 는 orgs·contacts·deals 중 하나여야 합니다.")
    # 주소록 전체가 한 번에 나가는 길이다 — 누가 무엇을 몇 행 뽑았는지 남긴다(15 §8.1)
    audit.record(
        db,
        "crm.exported",
        request=request,
        actor_id=user.id,
        detail={"entity": entity, "rows": len(rows)},
    )
    await db.commit()
    return Response(content=_xlsx(sheet, header, rows, int_col), media_type=XLSX)
