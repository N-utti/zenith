"""04 밖 — 사원용 사람 목록(`GET /people`). 프론트가 채널 멤버를 긁어 명단을 만들던 자리를 대신한다."""

from httpx import AsyncClient

from .conftest import Users, login


async def test_anyone_logged_in_sees_everyone_with_active(
    client: AsyncClient, users: Users, app_db
) -> None:
    users.lead.active = False  # 비활성도 목록엔 있다 — 고를 수 없게 흐리는 것은 화면 몫
    users.exec.team_id = None  # 소속 없는 사람은 team null (#526)
    await app_db.flush()
    await login(client, "sujin@zenith.co.kr")  # member 도 볼 수 있다(계정 목록은 exec 전용)
    r = await client.get("/api/people")
    assert r.status_code == 200
    items = r.json()["items"]
    assert [p["name"] for p in items] == ["김수진", "박동현", "최재호"]  # 이름순
    assert {p["name"]: p["active"] for p in items} == {
        "김수진": True,
        "박동현": False,
        "최재호": True,
    }
    assert items[0]["id"] == str(users.member.id)
    assert set(items[0]) == {"id", "name", "active", "role", "team"}  # 이메일은 안 준다
    # #526: 등급은 /me 와 같은 값, 팀은 {id, name} 또는 null
    assert [p["role"] for p in items] == ["member", "lead", "exec"]
    assert items[0]["team"] == {"id": str(users.team.id), "name": "개발팀"}
    assert items[2]["team"] is None


async def test_requires_login(client: AsyncClient, users: Users) -> None:
    assert (await client.get("/api/people")).status_code == 401
