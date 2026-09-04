"""04-API §2 홈·개인."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["me"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        (
            "GET",
            "/me/home",
            "대시보드 집계 1콜 {recent_docs[], mentions[], unread[], posts[], todos[]}",
        ),
        ("GET", "/me/todos", "오늘 할 일 목록"),
        ("POST", "/me/todos", "할 일 추가 {text}"),
        ("PATCH", "/me/todos/{id}", "할 일 수정 {text?, done?}"),
        ("DELETE", "/me/todos/{id}", "할 일 삭제"),
        ("GET", "/me/notifications", "알림 목록 (?unread=1)"),
        ("POST", "/me/notifications/read", "읽음 처리 {ids[]}"),
    ],
)
