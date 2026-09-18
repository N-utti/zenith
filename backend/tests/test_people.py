"""04 밖 — 사원용 사람 목록(`GET /people`). 프론트가 채널 멤버를 긁어 명단을 만들던 자리를 대신한다."""

from httpx import AsyncClient

from .conftest import Users, login


async def test_anyone_logged_in_sees_everyone_with_active(
    client: AsyncClient, users: Users, app_db
) -> None:
    users.lead.active = False  # 비활성도 목록엔 있다 — 고를 수 없게 흐리는 것은 화면 몫
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
    assert set(items[0]) == {"id", "name", "active"}  # 이메일·등급은 안 준다


async def test_requires_login(client: AsyncClient, users: Users) -> None:
    assert (await client.get("/api/people")).status_code == 401
