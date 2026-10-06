"""04-API §1 · 11 §4.3·§7.5 · 07 TC-AUTH-01~03 · TC-SEC-02~03 — 실제 Postgres 위에서 돈다."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from httpx import AsyncClient

from app import audit
from app.config import settings
from app.models import AuditEvent
from app.security import create_token

from .conftest import PASSWORD, Users, csrf, login


def _cookie_names(response) -> list[str]:
    return sorted(c.split("=", 1)[0] for c in response.headers.get_list("set-cookie"))


def _session_id(client: AsyncClient) -> uuid.UUID:
    payload = jwt.decode(client.cookies["access"], options={"verify_signature": False})
    return uuid.UUID(payload["sid"])


def _cookies(**values: str) -> dict[str, str]:
    """쿠키 항아리를 우회해 원하는 쿠키만 보낸다 — 위조·만료·옛 토큰을 심을 때."""
    return {"Cookie": "; ".join(f"{k}={v}" for k, v in values.items())}


async def test_login_sets_three_cookies_then_me(client: AsyncClient, users: Users) -> None:
    r = await login(client, "Sujin@zenith.co.kr ")
    assert r.status_code == 204
    assert r.content == b""
    assert _cookie_names(r) == ["access", "csrf", "refresh"]
    for c in r.headers.get_list("set-cookie"):
        assert "SameSite=lax" in c and "Path=/" in c
        assert ("Secure" in c) == settings.cookie_secure  # 로컬 http 개발은 false
        assert ("HttpOnly" in c) == (not c.startswith("csrf="))  # csrf 만 JS 가 읽는다

    r = await client.get("/api/me")
    assert r.status_code == 200
    assert r.json() == {
        "id": str(users.member.id),
        "name": "김수진",
        "email": "sujin@zenith.co.kr",
        "role": "member",
        "avatar": None,
        "team": {"id": str(users.team.id), "name": "개발팀"},
    }


async def test_me_requires_login(client: AsyncClient, users: Users) -> None:
    r = await client.get("/api/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "로그인이 필요합니다.", "code": "AUTH_REQUIRED"}


async def test_wrong_password_and_unknown_email_are_indistinguishable(
    client: AsyncClient, users: Users, app_db
) -> None:
    a = await login(client, "sujin@zenith.co.kr", "nope")
    b = await login(client, "nobody@zenith.co.kr", "nope")
    assert a.status_code == b.status_code == 401
    assert (
        a.json()
        == b.json()
        == {
            "detail": "이메일 또는 비밀번호가 올바르지 않습니다.",
            "code": "AUTH_INVALID",
        }
    )
    assert _cookie_names(a) == []
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert await audit.count_since(app_db, "auth.login_fail", since) == 2


async def test_disabled_account_gets_notice_only_with_right_password(
    client: AsyncClient, users: Users, app_db
) -> None:
    """TC-AUTH-03: 비활성 계정 로그인 → 401 + 안내. 비밀번호가 틀리면 안내도 없다."""
    users.member.active = False
    await app_db.flush()
    r = await login(client, "sujin@zenith.co.kr")
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_DISABLED"
    r = await login(client, "sujin@zenith.co.kr", "nope")
    assert r.json()["code"] == "AUTH_INVALID"


async def test_repeated_failures_are_throttled(client: AsyncClient, users: Users, app_db) -> None:
    for _ in range(settings.login_max_failures):
        app_db.add(
            AuditEvent(
                kind="auth.login_fail", ip="127.0.0.1", detail={"email": "sujin@zenith.co.kr"}
            )
        )
    await app_db.flush()
    r = await login(client, "sujin@zenith.co.kr")
    assert r.status_code == 429
    assert r.json()["code"] == "AUTH_THROTTLED"
    assert r.headers["Retry-After"] == str(settings.login_failure_window_minutes * 60)
    # 다른 계정은 영향이 없다
    assert (await login(client, "donghyun@zenith.co.kr")).status_code == 204


async def test_expired_access_then_refresh(client: AsyncClient, users: Users) -> None:
    """TC-AUTH-02: 만료된 access + 유효한 refresh → 재발급."""
    await login(client, "sujin@zenith.co.kr")
    expired = create_token(
        user_id=users.member.id,
        session_id=_session_id(client),
        kind="access",
        ttl=timedelta(seconds=-1),
    )
    r = await client.get("/api/me", headers=_cookies(access=expired))
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_EXPIRED")
    r = await client.post("/api/auth/refresh", headers=csrf(client))
    assert r.status_code == 204
    assert _cookie_names(r) == ["access", "csrf", "refresh"]
    assert (await client.get("/api/me")).status_code == 200


async def test_refresh_rotates_and_reuse_kills_the_session(
    client: AsyncClient, users: Users, monkeypatch
) -> None:
    """NFR-02 회전: 옛 refresh 가 다시 오면 탈취로 보고 세션을 통째로 닫는다(유예 창 밖)."""
    from app.routers import auth as mod

    monkeypatch.setattr(mod, "REFRESH_GRACE", timedelta(0))
    await login(client, "sujin@zenith.co.kr")
    old_refresh = client.cookies["refresh"]
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 204
    assert client.cookies["refresh"] != old_refresh
    assert (await client.get("/api/me")).status_code == 200

    r = await client.post(
        "/api/auth/refresh",
        headers={**csrf(client), **_cookies(refresh=old_refresh, csrf=client.cookies["csrf"])},
    )
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_INVALID")
    assert (await client.get("/api/me")).status_code == 401  # access 도 같이 죽는다


async def test_concurrent_refresh_within_grace_is_not_theft(
    client: AsyncClient, users: Users, monkeypatch
) -> None:
    """#340: 회전 직후(유예 안) 같은 옛 토큰이 또 오면 동시 refresh 로 본다 — 평문 주소엔 navigator.locks 가 없어
    탭마다 부른다. 회수하지 않고 현재 쿠키를 다시 내준다. 유예가 지나면 재사용 → 회수."""
    from app.routers import auth as mod

    await login(client, "sujin@zenith.co.kr")
    old_refresh = client.cookies["refresh"]
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 204
    from app.security import decode_token as _dt

    rotated_jti = _dt(client.cookies["refresh"], "refresh").jti
    r = await client.post(
        "/api/auth/refresh",
        headers={**csrf(client), **_cookies(refresh=old_refresh, csrf=client.cookies["csrf"])},
    )
    assert r.status_code == 204  # 유예 안 — 세션은 살아 있고 쿠키는 현재(회전된) jti 로 다시 내준다
    assert _dt(client.cookies["refresh"], "refresh").jti == rotated_jti
    assert (await client.get("/api/me")).status_code == 200
    monkeypatch.setattr(mod, "REFRESH_GRACE", timedelta(0))
    r = await client.post(
        "/api/auth/refresh",
        headers={**csrf(client), **_cookies(refresh=old_refresh, csrf=client.cookies["csrf"])},
    )
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_INVALID")


async def test_refresh_keeps_the_absolute_expiry_and_rejects_deactivated_user(
    client: AsyncClient, users: Users, app_db
) -> None:
    from app.models import AuthSession

    await login(client, "sujin@zenith.co.kr")
    session = await app_db.get(AuthSession, _session_id(client))
    assert session is not None
    expires_at = session.expires_at
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 204
    await app_db.refresh(session)
    assert session.expires_at == expires_at  # 슬라이딩 없음 — 로그인 후 14일에 끝난다

    # 관리 API 를 거치지 않고 DB 에서 바로 비활성화돼도(세션은 아직 살아 있음) refresh 는 막히고 세션이 닫힌다
    users.member.active = False
    await app_db.flush()
    r = await client.post("/api/auth/refresh", headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_DISABLED")
    await app_db.refresh(session)
    assert session.revoked_at is not None


async def test_logout_with_only_a_refresh_cookie_still_revokes(
    client: AsyncClient, users: Users, app_db
) -> None:
    from app.models import AuthSession

    await login(client, "sujin@zenith.co.kr")
    sid = _session_id(client)
    r = await client.post(
        "/api/auth/logout",
        headers={**csrf(client), **_cookies(refresh=client.cookies["refresh"])},
    )
    assert r.status_code == 204
    session = await app_db.get(AuthSession, sid)
    assert session is not None and session.revoked_at is not None


async def test_logout_revokes_immediately_and_is_idempotent(
    client: AsyncClient, users: Users
) -> None:
    await login(client, "sujin@zenith.co.kr")
    access = client.cookies["access"]
    r = await client.post("/api/auth/logout", headers=csrf(client))
    assert r.status_code == 204
    assert all("Max-Age=0" in c for c in r.headers.get_list("set-cookie"))
    assert _cookie_names(r) == ["access", "csrf", "refresh"]
    assert r.headers["clear-site-data"] == '"cache"'  # 공용 PC 의 캐시 비우기(#328)

    # 아직 15분이 안 지난 access 를 다시 보내도 세션이 죽었으니 401
    r = await client.get("/api/me", headers=_cookies(access=access))
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_INVALID")
    assert (await client.post("/api/auth/logout")).status_code == 204  # 쿠키 없이도 204


async def test_forged_session_id_is_rejected(client: AsyncClient, users: Users) -> None:
    """TC-SEC-02: 서명은 맞아도 없는 세션이면 401."""
    forged = create_token(
        user_id=users.member.id,
        session_id=uuid.uuid4(),
        kind="access",
        ttl=timedelta(minutes=15),
    )
    r = await client.get("/api/me", headers=_cookies(access=forged))
    assert (r.status_code, r.json()["code"]) == (401, "AUTH_INVALID")


async def test_csrf_double_submit_and_origin(client: AsyncClient, users: Users) -> None:
    """11 §4.3 — 쿠키 세션의 상태 변경 요청은 헤더가 쿠키와 같아야 하고 Origin 은 우리 것이어야 한다."""
    await login(client, "sujin@zenith.co.kr")
    r = await client.post("/api/auth/refresh")
    assert (r.status_code, r.json()["code"]) == (403, "CSRF_TOKEN")
    r = await client.post("/api/auth/refresh", headers={"X-CSRF-Token": "bogus"})
    assert r.json()["code"] == "CSRF_TOKEN"
    r = await client.post(
        "/api/auth/refresh", headers={**csrf(client), "Origin": "https://evil.example"}
    )
    assert (r.status_code, r.json()["code"]) == (403, "CSRF_ORIGIN")
    r = await client.post("/api/auth/refresh", headers={**csrf(client), "Origin": "https://test"})
    assert r.status_code == 204
    # 로그인도 교차 출처면 막는다 (로그인 CSRF)
    r = await client.post(
        "/api/auth/login",
        json={"email": "sujin@zenith.co.kr", "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert r.json()["code"] == "CSRF_ORIGIN"
    # 조회는 검사하지 않는다
    assert (
        await client.get("/api/me", headers={"Origin": "https://evil.example"})
    ).status_code == 200


async def test_csrf_header_must_match_the_session_hmac(client: AsyncClient, users: Users) -> None:
    """쿠키를 심을 수 있는 공격자가 cookie=header 로 맞춰 보내도, 세션 id 로 다시 계산한 값과 달라 403."""
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        "/api/auth/refresh",
        headers={
            "X-CSRF-Token": "attacker-chosen",
            **_cookies(
                access=client.cookies["access"],
                refresh=client.cookies["refresh"],
                csrf="attacker-chosen",
            ),
        },
    )
    assert (r.status_code, r.json()["code"]) == (403, "CSRF_TOKEN")


async def test_fetch_metadata_blocks_cross_site_even_without_origin(
    client: AsyncClient, users: Users
) -> None:
    await login(client, "sujin@zenith.co.kr")
    for site in ("cross-site", "same-site"):
        r = await client.post("/api/auth/refresh", headers={**csrf(client), "Sec-Fetch-Site": site})
        assert (r.status_code, r.json()["code"]) == (403, "CSRF_ORIGIN"), site
    r = await client.post(
        "/api/auth/refresh", headers={**csrf(client), "Sec-Fetch-Site": "same-origin"}
    )
    assert r.status_code == 204
    r = await client.post(
        "/api/auth/login",
        json={"email": "sujin@zenith.co.kr", "password": PASSWORD},
        headers={"Sec-Fetch-Site": "cross-site"},
    )
    assert r.json()["code"] == "CSRF_ORIGIN"


async def test_non_browser_clients_and_allowed_shells_pass_the_origin_check(
    client: AsyncClient, users: Users, monkeypatch
) -> None:
    """Origin·Sec-Fetch-Site 가 둘 다 없는 요청(curl)은 쿠키를 자동으로 싣지 않으니 통과. 등록된 셸 오리진도 통과."""
    await login(client, "sujin@zenith.co.kr")
    assert (await client.post("/api/auth/refresh", headers=csrf(client))).status_code == 204
    monkeypatch.setattr(settings, "cors_origins", ["tauri://localhost"])
    r = await client.post(
        "/api/auth/refresh",
        headers={**csrf(client), "Origin": "tauri://localhost", "Sec-Fetch-Site": "cross-site"},
    )
    assert r.status_code == 204


async def test_lockout_needs_the_same_ip_as_the_failures(
    client: AsyncClient, users: Users, app_db
) -> None:
    """남의 주소로 실패를 쌓아도 그 사람은 다른 IP 에서 로그인할 수 있다."""
    for _ in range(settings.login_max_failures):
        app_db.add(
            AuditEvent(
                kind="auth.login_fail", ip="10.0.0.99", detail={"email": "sujin@zenith.co.kr"}
            )
        )
    await app_db.flush()
    assert (
        await login(client, "sujin@zenith.co.kr")
    ).status_code == 204  # 테스트 클라이언트는 127.0.0.1


async def test_failures_from_one_ip_are_throttled_across_emails(
    client: AsyncClient, users: Users, app_db
) -> None:
    for i in range(settings.login_max_failures_per_ip):
        app_db.add(
            AuditEvent(
                kind="auth.login_fail", ip="127.0.0.1", detail={"email": f"x{i}@zenith.co.kr"}
            )
        )
    await app_db.flush()
    r = await login(client, "sujin@zenith.co.kr")
    assert (r.status_code, r.json()["code"]) == (429, "AUTH_THROTTLED")


async def test_yjs_check_for_forward_auth(client: AsyncClient, users: Users) -> None:
    """TC-SEC-03: 쿠키 없이 → 거부. 있으면 204 + 사용자 헤더."""
    assert (await client.get("/api/auth/yjs-check")).status_code == 401
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/auth/yjs-check")
    assert r.status_code == 204
    assert r.headers["X-User-Id"] == str(users.member.id)
    assert r.headers["X-User-Role"] == "member"


async def test_password_change_keeps_this_session_and_kills_others(
    client: AsyncClient, make_client, users: Users
) -> None:
    await login(client, "sujin@zenith.co.kr")
    async with make_client() as other:
        await login(other, "sujin@zenith.co.kr")
        r = await client.post(
            "/api/me/password",
            json={"current_password": "nope", "new_password": "new-password-1"},
            headers=csrf(client),
        )
        assert (r.status_code, r.json()["code"]) == (400, "PASSWORD_MISMATCH")
        r = await client.post(
            "/api/me/password",
            json={"current_password": PASSWORD, "new_password": "new-password-1"},
            headers=csrf(client),
        )
        assert r.status_code == 204
        assert (await client.get("/api/me")).status_code == 200
        assert (await other.get("/api/me")).status_code == 401
    assert (await login(client, "sujin@zenith.co.kr")).status_code == 401
    assert (await login(client, "sujin@zenith.co.kr", "new-password-1")).status_code == 204
