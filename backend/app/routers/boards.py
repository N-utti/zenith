"""04-API §6 게시판. 권한 밖 글은 목록에서 제목 마스킹, 본문은 403 — UI가 아니라 여기서 한다."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["boards"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        ("GET", "/boards", "게시판 목록 (내 등급 표시)"),
        (
            "GET",
            "/boards/{id}/posts",
            "글 목록 — 권한 밖이면 {title: '＿＿＿＿＿ 보고', masked: true}",
        ),
        ("POST", "/boards/{id}/posts", "글 작성 (min_role 이상)"),
        ("GET", "/posts/{id}", "글 본문 — 권한 밖 403"),
        ("PATCH", "/posts/{id}", "글 수정"),
        ("DELETE", "/posts/{id}", "글 삭제"),
    ],
)
