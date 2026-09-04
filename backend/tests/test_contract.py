"""04-API 명세서(및 13 §9)의 경로가 전부 OpenAPI에 있어야 한다 — docs/README "계약의 강제"."""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.main import create_app

CONTRACT_PATHS = {
    # §1 인증 · §4.2 프록시 인증 확인 · §9 관리
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/yjs-check",
    "/api/me",
    "/api/me/password",
    "/api/healthz",
    "/api/admin/users",
    "/api/admin/users/{user_id}",
    "/api/admin/audit",
    # §2 홈·개인
    "/api/me/home",
    "/api/me/todos",
    "/api/me/todos/{id}",
    "/api/me/notifications",
    "/api/me/notifications/read",
    # §3 문서
    "/api/tree",
    "/api/folders",
    "/api/folders/{id}",
    "/api/docs",
    "/api/docs/{id}",
    "/api/docs/{id}/versions",
    "/api/docs/{id}/restore",
    "/api/docs/{id}/comments",
    # §5 채팅
    "/api/channels",
    "/api/channels/{id}/messages",
    "/api/channels/{id}/attachments",
    # §6 게시판 · §7 검색
    "/api/boards",
    "/api/boards/{id}/posts",
    "/api/posts/{id}",
    "/api/search",
    # §8 AI
    "/api/ai/models",
    "/api/ai/chat",
    "/api/ai/feedback",
    "/api/ai/doc-action",
    "/api/ai/template",
    # §10 근태
    "/api/attendance/me",
    "/api/attendance/me/summary",
    "/api/attendance/arrangements",
    "/api/attendance/overtime",
    "/api/attendance/corrections",
    "/api/leaves/balance",
    "/api/leaves",
    "/api/leaves/{id}/cancel",
    "/api/leave-types",
    "/api/attendance/team",
    "/api/attendance/report",
    "/api/attendance/close",
    "/api/attendance/reopen",
    "/api/admin/holidays",
    "/api/admin/attendance/calendar/rebuild",
    "/api/admin/leave-policy",
    # 13 §9 결재
    "/api/approval-types",
    "/api/approvals/drafts",
    "/api/approvals/drafts/{id}",
    "/api/approvals/{id}/submit",
    "/api/approvals/{id}/cancel",
    "/api/approvals/{id}/approve",
    "/api/approvals/{id}/reject",
    "/api/approvals/{id}/force-close",
    "/api/approvals",
    "/api/approvals/{id}",
    "/api/approvals/delegations",
    "/api/approvals/delegations/{id}",
    "/api/admin/approval-policy",
}

# 폐기된 경로 — 10-근태 v0.3 P3(출퇴근 기록), 13 §7.1(근태 승인 → 결재 엔진)
RETIRED_PREFIXES = ("/api/attendance/approvals", "/api/attendance/check-")


def test_contract_paths_present(app: FastAPI) -> None:
    missing = CONTRACT_PATHS - set(app.openapi()["paths"])
    assert not missing, f"계약에 있는데 서버에 없는 경로: {sorted(missing)}"


def test_retired_paths_absent(app: FastAPI) -> None:
    retired = [p for p in app.openapi()["paths"] if p.startswith(RETIRED_PREFIXES)]
    assert not retired, f"폐기된 경로가 남아 있다: {retired}"


def test_openapi_json_is_current(app: FastAPI) -> None:
    """커밋된 openapi.json 이 코드와 같아야 한다. 다르면 scripts/export_openapi.py 를 돌린다."""
    committed = json.loads(
        (Path(__file__).resolve().parent.parent / "openapi.json").read_text(encoding="utf-8")
    )
    assert committed == app.openapi()


async def test_healthz(client: AsyncClient) -> None:
    r = await client.get("/api/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_stub_returns_501_with_error_shape(client: AsyncClient, member) -> None:
    r = await client.get("/api/tree")
    assert r.status_code == 501
    assert r.json() == {"detail": "아직 구현되지 않은 엔드포인트입니다.", "code": "NOT_IMPLEMENTED"}


async def test_validation_error_shape(client: AsyncClient, member) -> None:
    r = await client.post("/api/ai/chat", json={"message": ""})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "VALIDATION"
    assert body["detail"][0]["loc"] == ["body", "message"]


def test_cors_wildcard_is_refused(monkeypatch) -> None:
    """쿠키 자격증명 + '*' 는 어느 오리진에서나 응답을 읽게 한다 — 기동 자체를 막는다."""
    from app.config import settings

    monkeypatch.setattr(settings, "cors_origins", ["*"])
    with pytest.raises(ValueError):
        create_app()


async def test_router_404_and_405_keep_error_shape(client: AsyncClient) -> None:
    """라우터가 던지는 Starlette HTTPException 도 04 §0 모양이어야 한다."""
    r = await client.get("/api/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found", "code": "NOT_FOUND"}
    r = await client.post("/api/healthz")
    assert r.status_code == 405
    assert r.json()["code"] == "METHOD_NOT_ALLOWED"
