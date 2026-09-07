"""13-전자결재 §9 결재 엔진 API. 근태 신청 4종의 승인도 여기로 온다(Q2)."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["approvals"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        # §9.1 기안
        ("GET", "/approval-types", "문서 유형 목록 + 유형별 기본 결재선"),
        ("POST", "/approvals/drafts", "{type_code, title, subject, steps?} 임시저장"),
        ("PATCH", "/approvals/drafts/{id}", "임시저장 수정"),
        ("POST", "/approvals/{id}/submit", "상신 → pending. 도메인 사전검증 실패 422"),
        ("POST", "/approvals/{id}/cancel", "회수. 승인된 단계가 있으면 409"),
        # §9.2 결재 처리
        (
            "POST",
            "/approvals/{id}/approve",
            "{comment?, version} → 다음 단계 또는 확정. version 불일치 409",
        ),
        ("POST", "/approvals/{id}/reject", "{reason, version} — 사유 없으면 400"),
        ("POST", "/approvals/{id}/force-close", "{reason} exec 강제 종결 — 감사 로그"),
        # §9.3 조회
        (
            "GET",
            "/approvals",
            "?box=inbox|sent|reference|draft 결재함 · ?type=&status=&from=&to=&drafter= 필터",
        ),
        ("GET", "/approvals/{id}", "문서 상세 + 결재선 진행 + 의견 이력. 권한 밖 403"),
        ("GET", "/approvals/delegations", "위임 목록"),
        ("POST", "/approvals/delegations", "위임 설정"),
        ("DELETE", "/approvals/delegations/{id}", "위임 해제"),
    ],
)
