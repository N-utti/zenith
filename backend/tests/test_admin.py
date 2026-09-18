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


async def test_team_list_is_exec_only(client: AsyncClient, users: Users, app_db) -> None:
    """계정 응답은 team_id 만 준다 — 이름으로 풀고 배정 후보를 고르려면 목록이 있어야 한다(프론트 #102)."""
    await login(client, "sujin@zenith.co.kr")
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert (await client.get("/api/admin/teams")).status_code == 403
    assert await audit.count_since(app_db, "acl.denied", since, path="/api/admin/teams") == 1
    await login(client, "jaeho@zenith.co.kr")
    r = await client.get("/api/admin/teams")
    assert r.status_code == 200
    assert r.json() == [{"id": str(users.team.id), "name": "개발팀"}]


async def test_blank_name_is_rejected_and_stored_trimmed(client: AsyncClient, users: Users) -> None:
    """`min_length=1` 을 다듬기 전에 재면 공백만 있는 이름이 통과해 빈 이름으로 저장됐다(프론트 #102)."""
    await login(client, "jaeho@zenith.co.kr")
    blank = {"name": "   ", "email": "new@zenith.co.kr", "password": "zenith1234"}
    assert (
        await client.post("/api/admin/users", json=blank, headers=csrf(client))
    ).status_code == 422
    r = await client.patch(
        f"/api/admin/users/{users.member.id}", json={"name": " \t "}, headers=csrf(client)
    )
    assert r.status_code == 422

    r = await client.post(
        "/api/admin/users", json={**blank, "name": "  새 사람  "}, headers=csrf(client)
    )
    assert r.status_code == 201 and r.json()["name"] == "새 사람"  # 앞뒤 공백은 다듬어 저장
    r = await client.patch(
        f"/api/admin/users/{users.member.id}", json={"name": "  김수진2 "}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["name"] == "김수진2"


async def test_explicit_null_is_422_not_409(client: AsyncClient, users: Users) -> None:
    """`null` 은 "안 보냈다"가 아니다 — NOT NULL 위반이 409 로 튀어나오던 것을 422 로 막는다."""
    await login(client, "jaeho@zenith.co.kr")
    for field in ("name", "role", "active"):
        r = await client.patch(
            f"/api/admin/users/{users.member.id}", json={field: None}, headers=csrf(client)
        )
        assert r.status_code == 422, (field, r.text)
    # 팀·입사일은 진짜로 비울 수 있는 칸이다
    r = await client.patch(
        f"/api/admin/users/{users.member.id}",
        json={"team_id": None, "hire_date": None},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["team_id"] is None


async def test_team_create_and_rename(client: AsyncClient, users: Users, app_db) -> None:
    """팀을 만들 수 없으면 목록도 seed 의 한 줄뿐이라 관리자 화면의 팀 배정이 무의미하다."""
    await login(client, "sujin@zenith.co.kr")
    since = datetime.now(UTC) - timedelta(minutes=1)
    r = await client.post("/api/admin/teams", json={"name": "영업팀"}, headers=csrf(client))
    assert r.status_code == 403
    assert await audit.count_since(app_db, "acl.denied", since, path="/api/admin/teams") == 1

    await login(client, "jaeho@zenith.co.kr")
    r = await client.post("/api/admin/teams", json={"name": "  영업팀 "}, headers=csrf(client))
    assert r.status_code == 201 and r.json()["name"] == "영업팀"  # 앞뒤 공백은 다듬어 저장
    sales = r.json()["id"]
    for bad in ("   ", "영업팀"):  # 공백만 422 · 같은 이름 409
        r = await client.post("/api/admin/teams", json={"name": bad}, headers=csrf(client))
        assert r.status_code == (422 if bad.isspace() else 409), bad

    # 배정을 먼저 — 이름을 바꿔도 소속이 끊기지 않는지 보려면 순서가 이래야 한다
    r = await client.patch(
        f"/api/admin/users/{users.member.id}", json={"team_id": sales}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["team_id"] == sales

    r = await client.patch(
        f"/api/admin/teams/{sales}", json={"name": "세일즈팀"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["name"] == "세일즈팀"
    # 자기 이름 그대로 보내는 것은 통과(중복 검사가 자기 자신을 잡지 않는다), 남의 이름은 409
    assert (
        await client.patch(
            f"/api/admin/teams/{sales}", json={"name": "세일즈팀"}, headers=csrf(client)
        )
    ).status_code == 200
    assert (
        await client.patch(
            f"/api/admin/teams/{sales}", json={"name": "개발팀"}, headers=csrf(client)
        )
    ).status_code == 409
    assert (
        await client.patch(
            "/api/admin/teams/00000000-0000-0000-0000-000000000000",
            json={"name": "x"},
            headers=csrf(client),
        )
    ).status_code == 404

    # 목록은 이름순, 소속 계정은 이름이 바뀌어도 그대로
    assert [t["name"] for t in (await client.get("/api/admin/teams")).json()] == [
        "개발팀",
        "세일즈팀",
    ]
    mine = next(
        u for u in (await client.get("/api/admin/users")).json() if u["id"] == str(users.member.id)
    )
    assert mine["team_id"] == sales  # 이름이 바뀌어도 소속은 그대로
    r = await client.post("/api/admin/teams", json={"name": "가" * 101}, headers=csrf(client))
    assert r.status_code == 422  # 100자 상한

    # 이름 변경도 exec 만 — 상태를 바꾸는 경로마다 거부를 잰다
    await login(client, "sujin@zenith.co.kr")
    r = await client.patch(
        f"/api/admin/teams/{sales}", json={"name": "훔친 팀"}, headers=csrf(client)
    )
    assert r.status_code == 403
    assert await audit.count_since(app_db, "acl.denied", since) == 2
    assert await audit.count_since(app_db, "admin.team_created", since) == 1
    # 무변경 PATCH 는 감사에 안 남는다 — 폼 전체를 보내는 화면이 저장할 때마다 줄이 쌓이지 않게
    assert await audit.count_since(app_db, "admin.team_updated", since) == 1
