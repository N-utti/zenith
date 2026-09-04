"""04-API §1 인증. JWT HttpOnly 쿠키 — access 15분 / refresh 14일. 로그인은 204 + Set-Cookie."""

import uuid

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import User
from app.security import clear_auth_cookies, decode_token, set_auth_cookies, verify_password

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class MeOut(BaseModel):
    """04 §1 `GET /me` → {id, name, email, role, avatar}."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: str
    avatar: str | None


@router.post(
    "/auth/login",
    status_code=204,
    response_class=Response,
    summary="로그인 → 204 + Set-Cookie(access/refresh)",
)
async def login(body: LoginIn, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    email = body.email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.active or not verify_password(body.password, user.pw_hash):
        raise ApiError(401, "AUTH_INVALID", "이메일 또는 비밀번호가 올바르지 않습니다.")
    set_auth_cookies(response, str(user.id))


@router.post(
    "/auth/refresh",
    status_code=204,
    response_class=Response,
    summary="refresh 쿠키로 access/refresh 재발급",
)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    token = request.cookies.get("refresh")
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
    user = await db.get(User, decode_token(token, "refresh"))
    if user is None or not user.active:
        raise ApiError(401, "AUTH_INVALID", "사용 중지된 계정이거나 존재하지 않습니다.")
    set_auth_cookies(response, str(user.id))


@router.post("/auth/logout", status_code=204, response_class=Response, summary="쿠키 제거")
async def logout(response: Response) -> None:
    clear_auth_cookies(response)


@router.get("/me", response_model=MeOut, summary="내 프로필")
async def me(user: User = Depends(current_user)) -> User:
    return user
