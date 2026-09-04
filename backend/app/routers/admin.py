"""exec 전용 관리 — 04-API §9 · §10.4(근태) · 13 §9.3(결재 정책)."""

from fastapi import APIRouter, Depends

from app.deps import require_role
from app.stubs import register_stubs

router = APIRouter(tags=["admin"], dependencies=[Depends(require_role("exec"))])

register_stubs(
    router,
    [
        ("GET", "/admin/users", "계정 목록"),
        ("POST", "/admin/users", "계정 생성"),
        ("PATCH", "/admin/users/{id}", "등급 변경·비활성화"),
        ("GET", "/admin/audit", "?kind=acl 권한 위반 시도 로그(403 기록)"),
        ("GET", "/admin/holidays", "공휴일·회사 휴일 목록"),
        ("POST", "/admin/holidays", "휴일 등록 → 근무 달력 재생성 (10-근태 §6.2)"),
        ("POST", "/admin/attendance/calendar/rebuild", "{year} 근무 달력 재생성"),
        ("GET", "/admin/leave-policy", "연차 부여 기준 (입사일 / 회계연도)"),
        ("PATCH", "/admin/leave-policy", "연차 부여 기준 변경"),
        ("GET", "/admin/approval-policy", "결재 양식·전결 기준 (13 §9.3)"),
        ("PATCH", "/admin/approval-policy", "결재 양식·전결 기준 변경"),
    ],
)
