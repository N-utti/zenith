"""04-API §9 계정·감사 — FR-AUTH-03 · TC-SEC-05 · 11 §7.4."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app import audit
from app.models import AuditEvent

from .conftest import Users, csrf, login


async def test_member_is_denied_and_the_attempt_is_logged(
    client: AsyncClient, users: Users, app_db
) -> None:
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/admin/users")
    assert r.status_code == 403
    assert r.json() == {"detail": "권한이 부족합니다.", "code": "FORBIDDEN"}
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert await audit.count_since(app_db, "acl.denied", since, path="/api/admin/users") == 1


async def test_lead_is_not_exec(client: AsyncClient, users: Users) -> None:
    await login(client, "donghyun@zenith.co.kr")
    assert (await client.get("/api/admin/users")).status_code == 403


async def test_unknown_role_fails_closed(client: AsyncClient, users: Users, app_db) -> None:
    """TC-SEC-05: role 컬럼에 모르는 값이 있어도 승격이 아니라 최소 권한이다."""
    users.member.role = "admin"
    await app_db.flush()
    await login(client, "sujin@zenith.co.kr")
    assert (await client.get("/api/admin/users")).status_code == 403


async def test_exec_lists_creates_and_updates_accounts(client: AsyncClient, users: Users) -> None:
    await login(client, "jaeho@zenith.co.kr")
    r = await client.get("/api/admin/users")
    assert r.status_code == 200
    assert [u["name"] for u in r.json()] == ["김수진", "박동현", "최재호"]
    assert set(r.json()[0]) == {
        "id",
        "name",
        "email",
        "role",
        "avatar",
        "active",
        "team_id",
        "hire_date",
        "created_at",
    }

    body = {
        "name": " 이신입 ",
        "email": "New@zenith.co.kr",
        "password": "welcome-123",
        "role": "lead",
        "team_id": str(users.team.id),
    }
    r = await client.post("/api/admin/users", json=body, headers=csrf(client))
    assert r.status_code == 201
    created = r.json()
    assert created["team_id"] == str(users.team.id)
    assert (created["name"], created["email"], created["role"], created["active"]) == (
        "이신입",
        "new@zenith.co.kr",
        "lead",
        True,
    )
    assert created["created_at"] is not None

    # 없는 팀은 500(외래키 위반)이 아니라 422
    ghost = {
        **body,
        "email": "ghost@zenith.co.kr",
        "team_id": "00000000-0000-0000-0000-000000000000",
    }
    r = await client.post("/api/admin/users", json=ghost, headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")

    r = await client.post("/api/admin/users", json=body, headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (409, "CONFLICT")
    r = await client.post(
        "/api/admin/users", json={**body, "email": "x", "password": "short"}, headers=csrf(client)
    )
    assert r.status_code == 422
    r = await client.post(
        "/api/admin/users", json={**body, "email": "a@b.co", "role": "admin"}, headers=csrf(client)
    )
    assert r.status_code == 422

    r = await client.patch(
        f"/api/admin/users/{created['id']}",
        json={"role": "member", "active": False},
        headers=csrf(client),
    )
    assert r.status_code == 200
    assert (r.json()["role"], r.json()["active"]) == ("member", False)
    assert (await login(client, "new@zenith.co.kr", "welcome-123")).json()[
        "code"
    ] == "AUTH_DISABLED"

    r = await client.patch(
        f"/api/admin/users/{users.exec.id}", json={"active": False}, headers=csrf(client)
    )
    assert (r.status_code, r.json()["code"]) == (400, "ADMIN_SELF")
    r = await client.patch(
        "/api/admin/users/00000000-0000-0000-0000-000000000000",
        json={"name": "x"},
        headers=csrf(client),
    )
    assert r.status_code == 404


async def test_deactivation_kills_a_live_session(
    client: AsyncClient, make_client, users: Users
) -> None:
    async with make_client() as victim:
        await login(victim, "sujin@zenith.co.kr")
        assert (await victim.get("/api/me")).status_code == 200
        await login(client, "jaeho@zenith.co.kr")
        r = await client.patch(
            f"/api/admin/users/{users.member.id}", json={"active": False}, headers=csrf(client)
        )
        assert r.status_code == 200
        r = await victim.get("/api/me")
        assert (r.status_code, r.json()["code"]) == (401, "AUTH_DISABLED")


async def test_temp_password_revokes_sessions(
    client: AsyncClient, make_client, users: Users
) -> None:
    async with make_client() as victim:
        await login(victim, "sujin@zenith.co.kr")
        await login(client, "jaeho@zenith.co.kr")
        r = await client.patch(
            f"/api/admin/users/{users.member.id}",
            json={"password": "temp-pass-99"},
            headers=csrf(client),
        )
        assert r.status_code == 200
        assert (await victim.get("/api/me")).status_code == 401
        assert (await login(victim, "sujin@zenith.co.kr")).status_code == 401
        assert (await login(victim, "sujin@zenith.co.kr", "temp-pass-99")).status_code == 204


async def test_audit_kind_prefix_and_cursor_paging(
    client: AsyncClient, users: Users, app_db
) -> None:
    for i in range(5):
        app_db.add(AuditEvent(kind="acl.denied", actor_id=users.member.id, detail={"n": i}))
    for _ in range(3):
        app_db.add(AuditEvent(kind="auth.login_ok", actor_id=users.member.id))
    await app_db.flush()
    await login(client, "jaeho@zenith.co.kr")

    seen: list[dict] = []
    cursor = None
    while True:
        params = {"kind": "acl", "limit": 2, **({"cursor": cursor} if cursor else {})}
        r = await client.get("/api/admin/audit", params=params)
        assert r.status_code == 200
        page = r.json()
        seen += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == 5
    assert all(item["kind"] == "acl.denied" for item in seen)
    assert len({item["id"] for item in seen}) == 5
    assert set(seen[0]) == {
        "id",
        "at",
        "kind",
        "actor_id",
        "target_id",
        "ip",
        "user_agent",
        "detail",
    }

    r = await client.get("/api/admin/audit", params={"kind": "auth"})
    kinds = {item["kind"] for item in r.json()["items"]}
    assert kinds == {"auth.login_ok"}  # 방금 exec 로그인도 여기 들어 있다
    # LIKE 와일드카드는 글자 그대로다
    assert (await client.get("/api/admin/audit", params={"kind": "%"})).json()["items"] == []
    assert (await client.get("/api/admin/audit", params={"kind": "_cl"})).json()["items"] == []
    assert (await client.get("/api/admin/audit", params={"cursor": "!!"})).status_code == 422
    assert (await client.get("/api/admin/audit", params={"limit": 0})).status_code == 422
