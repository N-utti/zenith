"""04-API §10 근태(ATT) — 조회·신청 계열만.

출퇴근 기록(check-in/out, sync, import, identities, recompute)은 10-근태 v0.3 P3로 폐기됐고,
`/attendance/approvals*` 는 13-전자결재 §7.1로 폐기돼 `/approvals` 계열(approvals.py)이 대신한다.
"""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["attendance"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [
        # §10.1 개인
        ("GET", "/attendance/me", "?month= 월별 일자 배열 + 월 집계 {days[], summary}"),
        ("GET", "/attendance/me/summary", "?from=&to= 기간 집계"),
        ("POST", "/attendance/arrangements", "{kind, start_date, end_date, reason} 재택·외근·출장"),
        ("GET", "/attendance/arrangements", "?scope=me|team 예외근무 목록 (team은 lead 이상)"),
        ("POST", "/attendance/overtime", "{work_date, start_time, end_time, reason} 연장근로"),
        ("GET", "/attendance/overtime", "?from=&to= 내 연장근로 목록·누계"),
        (
            "POST",
            "/attendance/corrections",
            "{work_date, after:{status?, note?}, reason} 정정 신청",
        ),
        ("GET", "/attendance/corrections", "?status=pending 내 정정 신청 목록"),
        # §10.2 휴가
        ("GET", "/leaves/balance", "{year, granted, used, remaining, expires_on, grant_basis}"),
        ("GET", "/leaves", "?scope=me|team 휴가 목록"),
        ("POST", "/leaves", "{type_code, start_date, end_date, reason} — 잔여 부족 422"),
        ("POST", "/leaves/{id}/cancel", "승인 전 취소"),
        ("GET", "/leave-types", "휴가 종류 목록"),
        # §10.3 팀·리포트 (승인은 /approvals 로 이관)
        ("GET", "/attendance/team", "?month=&team_id= 팀원 × 일자 그리드 — 타 팀 403"),
        ("GET", "/attendance/report", "?month=&format=csv 월 리포트 (exec)"),
        ("POST", "/attendance/close", "월 마감 (exec)"),
        ("POST", "/attendance/reopen", "월 마감 해제 {reason} 필수 + 감사 로그 (exec)"),
    ],
)
