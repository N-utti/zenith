"""04-API §3 문서 트리·문서. 실시간(§4 /ws, /yjs)은 WebSocket이라 여기 없다 — README 참조."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["docs"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        ("GET", "/tree", "사이드바 트리 {folders[], docs[]} (정렬 포함)"),
        ("POST", "/folders", "폴더 생성"),
        ("PATCH", "/folders/{id}", "폴더 이름·이동·정렬"),
        ("POST", "/docs", "{folder_id, title, blocks?} → 문서 생성 (AI 템플릿 저장 포함)"),
        ("GET", "/docs/{id}", "메타 + 최신 스냅숏 (초기 로드용)"),
        ("PATCH", "/docs/{id}", "제목·폴더 이동"),
        ("DELETE", "/docs/{id}", "휴지통 이동(30일) / ?hard=1 관리자만"),
        ("GET", "/docs/{id}/versions", "버전 목록"),
        ("POST", "/docs/{id}/restore", "버전 복구"),
        ("GET", "/docs/{id}/comments", "블록 댓글 목록"),
        ("POST", "/docs/{id}/comments", "{block_id?, body} — @멘션 파싱 → 알림"),
    ],
)
