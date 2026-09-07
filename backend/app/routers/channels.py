"""04-API §5 채팅 (REST 보조). 메시지 전송·읽음·타이핑은 §4.1 /ws 로 간다."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["chat"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        ("GET", "/channels", "내 채널·DM 목록 + unread 카운트"),
        ("POST", "/channels", "{name} 또는 {dm_user_id}"),
        ("GET", "/channels/{id}/messages", "과거 메시지 (?cursor=, 50개 단위)"),
        ("POST", "/channels/{id}/attachments", "multipart 업로드 → MinIO, {url, name, size}"),
    ],
)
