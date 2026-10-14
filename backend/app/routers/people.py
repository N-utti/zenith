"""04 밖 — 사원용 사람 목록.

계정 목록(`/admin/users`)은 exec 전용이라 일반 사용자가 사람을 고를 길이 없었다. 프론트는 내가 속한
채널의 멤버를 긁어 명단을 만들고 있었는데(`features/people/colleagues.ts`), 공개 채널에 전원이
들어가므로 대개 맞지만 DM 만 주고받는 사람은 빠지고 **활성 여부를 알 수 없다**(비활성에게 DM 을 열면 422).

ponytail: 15명 사내라 페이징·검색 없이 전부 준다. 수백 명이 되면 `?q=` 접두 검색과 상한을 먼저.
"""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import chat_command
from app.db import get_db
from app.deps import current_user
from app.models import User

router = APIRouter(tags=["people"], dependencies=[Depends(current_user)])


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    active: bool


class Items[T](BaseModel):
    items: list[T]


@router.get(
    "/people",
    response_model=Items[PersonOut],
    summary="사람 목록 — DM 상대·참조자·위임 대상 고르기. 이름순, 비활성 포함(active 로 구분)",
)
async def list_people(db: AsyncSession = Depends(get_db)) -> Items[PersonOut]:
    # 전사 공개가 성립하는 전제: 공개 채널에 전원이 들어가 `GET /channels` 의 members[] 가 이미 같은
    # 명단을 준다(channels.join_public_channels — 비공개 채널(README 12)은 건너뛰지만 공개 채널엔 여전히 전원). 초대제로 바꾸면 이
    # 경로도 같이 좁혀야 한다 — 안 그러면 좁힌 멤버십이 여기로 그대로 샌다.
    # 비활성도 준다: 감춰도 `/channels` members[] 와의 차집합으로 드러나므로 숨기는 대신 명시한다.
    # 세 칸만 — 로그인하면 누구나 부르는 경로라 비밀번호 해시까지 메모리로 끌어올 이유가 없다.
    rows = await db.execute(
        select(User.id, User.name, User.active)
        .where(User.email != chat_command.AI_EMAIL)  # AI 시스템 계정(README 52)은 사람 목록에 없다
        .order_by(User.name)
    )
    return Items(items=[PersonOut.model_validate(r) for r in rows])
