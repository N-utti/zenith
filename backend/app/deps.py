from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import ApiError
from app.models import ROLE_RANK, Role, User
from app.security import decode_token


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """access 쿠키 → 사용자. 쿠키가 없으면 DB를 건드리지 않고 401."""
    token = request.cookies.get("access")
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
    user = await db.get(User, decode_token(token, "access"))
    if user is None or not user.active:
        raise ApiError(401, "AUTH_INVALID", "사용 중지된 계정이거나 존재하지 않습니다.")
    return user


def require_role(min_role: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    """03-ERD §2.2: member < lead < exec 서열 하나로 판정한다."""

    async def dep(user: User = Depends(current_user)) -> User:
        # users.role 은 CHECK 없는 text — 모르는 값은 최소 권한(0)으로 닫는다.
        if ROLE_RANK.get(user.role, 0) < ROLE_RANK[min_role]:
            raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")
        return user

    return dep
