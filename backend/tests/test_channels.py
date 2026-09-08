"""04-API §5 채팅 REST — FR-CHT-01·03 · TC-CHT-02(배지 일치) · TC-AUTH-04(남의 채널)."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent, Channel, ChannelMember, Message, User, Workspace

from .conftest import Users, csrf, login


async def _seed(app_db, users: Users) -> dict:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    general = Channel(ws_id=ws.id, name="일반", is_dm=False)
    dm = Channel(ws_id=ws.id, name="", is_dm=True)
    quiet = Channel(ws_id=ws.id, name="조용", is_dm=False)  # 메시지 0건
    others = Channel(ws_id=ws.id, name="임원", is_dm=False)  # 김수진은 멤버 아님
    app_db.add_all([general, dm, quiet, others])
    await app_db.flush()
    now = datetime.now(UTC)
    app_db.add_all(
        [
            ChannelMember(
                channel_id=general.id,
                user_id=users.member.id,
                last_read_at=now - timedelta(hours=1),
            ),
            ChannelMember(channel_id=general.id, user_id=users.lead.id),
            ChannelMember(channel_id=dm.id, user_id=users.member.id),
            ChannelMember(channel_id=dm.id, user_id=users.exec.id),
            ChannelMember(channel_id=quiet.id, user_id=users.member.id),
            ChannelMember(channel_id=others.id, user_id=users.exec.id),
        ]
    )
    msgs = [
        Message(
            channel_id=general.id,
            author_id=users.lead.id,
            body=f"글 {i}",
            created_at=now - timedelta(minutes=10 - i),
        )
        for i in range(7)
    ]
    msgs.append(
        Message(
            channel_id=dm.id,
            author_id=users.exec.id,
            body="DM",
            created_at=now - timedelta(minutes=30),
        )
    )
    app_db.add_all(msgs)
    await app_db.flush()
    return {"general": general, "dm": dm, "quiet": quiet, "others": others, "ws": ws}


async def test_list_channels(client: AsyncClient, users: Users, app_db) -> None:
    """내 채널만, 안 읽음은 홈과 같은 기준, DM 은 상대 이름, 최근 대화가 위."""
    await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/channels")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["name"] for i in items] == ["일반", "최재호", "조용"]  # 내 채널만, 대화 없는 건 아래
    general, dm, quiet = items
    assert quiet["unread"] == 0 and quiet["last_message"] is None
    assert general["unread"] == 7 and general["last_message"]["body"] == "글 6"
    assert general["last_message"]["author"] == {"id": str(users.lead.id), "name": "박동현"}
    assert {m["name"] for m in general["members"]} == {"김수진", "박동현"}
    assert dm["is_dm"] and dm["unread"] == 1 and dm["last_message"]["body"] == "DM"
    home = (await client.get("/api/me/home")).json()
    assert {u["channel_id"]: u["count"] for u in home["unread"]} == {
        general["id"]: 7,
        dm["id"]: 1,
    }  # TC-CHT-02: 두 곳이 같은 수


async def test_create_public_channel_and_dm(client: AsyncClient, users: Users, app_db) -> None:
    """공개 채널은 활성 사용자 전원이 멤버. DM 은 같은 두 사람이면 하나뿐, 자기 자신·비활성 상대는 422."""
    seeded = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    users.exec.active = False  # 비활성 계정도 멤버 — 복직하면 보여야 한다
    await app_db.flush()
    r = await client.post("/api/channels", json={"name": " 마케팅 "}, headers=csrf(client))
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "마케팅" and len(r.json()["members"]) == 3
    users.exec.active = True
    await app_db.flush()
    group = Channel(
        ws_id=seeded["ws"].id, name="", is_dm=True
    )  # 3인짜리 is_dm — DM 재사용에 안 잡혀야
    app_db.add(group)
    await app_db.flush()
    app_db.add_all(
        [
            ChannelMember(channel_id=group.id, user_id=u.id)
            for u in (users.member, users.lead, users.exec)
        ]
    )
    await app_db.flush()
    r = await client.post("/api/channels", json={"name": "마케팅"}, headers=csrf(client))
    assert r.status_code == 409
    r = await client.post("/api/channels", json={}, headers=csrf(client))
    assert r.status_code == 422
    r = await client.post(
        "/api/channels", json={"name": "x", "dm_user_id": str(users.lead.id)}, headers=csrf(client)
    )
    assert r.status_code == 422

    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.lead.id)}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    dm = r.json()
    assert dm["is_dm"] and dm["name"] == "박동현" and len(dm["members"]) == 2
    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.lead.id)}, headers=csrf(client)
    )
    assert r.status_code == 201 and r.json()["id"] == dm["id"]  # 재사용
    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.exec.id)}, headers=csrf(client)
    )
    assert r.status_code == 201 and r.json()["id"] == str(seeded["dm"].id)  # _seed 의 DM 재사용
    assert dm["id"] != str(group.id)
    dms = (await app_db.execute(select(Channel).where(Channel.is_dm.is_(True)))).scalars().all()
    assert len(dms) == 3  # _seed DM · 3인 채널 · 새 DM
    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.member.id)}, headers=csrf(client)
    )
    assert r.status_code == 422
    users.exec.active = False
    await app_db.flush()
    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.exec.id)}, headers=csrf(client)
    )
    assert r.status_code == 422


async def test_messages_paging_and_forbidden(client: AsyncClient, users: Users, app_db) -> None:
    """오래된 순 페이지 + next_cursor 로 더 과거. 멤버 아니면(없는 채널도) 403 + acl.denied."""
    seeded = await _seed(app_db, users)
    gid = str(seeded["general"].id)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get(f"/api/channels/{gid}/messages?limit=3")
    assert r.status_code == 200, r.text
    page = r.json()
    assert [m["body"] for m in page["items"]] == ["글 4", "글 5", "글 6"] and page["next_cursor"]
    r = await client.get(f"/api/channels/{gid}/messages?limit=3&cursor={page['next_cursor']}")
    page = r.json()
    assert [m["body"] for m in page["items"]] == ["글 1", "글 2", "글 3"] and page["next_cursor"]
    r = await client.get(f"/api/channels/{gid}/messages?limit=3&cursor={page['next_cursor']}")
    page = r.json()
    assert [m["body"] for m in page["items"]] == ["글 0"] and page["next_cursor"] is None
    assert page["items"][0]["author"]["name"] == "박동현"
    r = await client.get(f"/api/channels/{gid}/messages?cursor=zzz")
    assert r.status_code == 422

    await login(client, "donghyun@zenith.co.kr")  # 팀장은 DM 멤버가 아니다
    dm_id = str(seeded["dm"].id)
    for cid in (dm_id, "00000000-0000-0000-0000-000000000000"):
        r = await client.get(f"/api/channels/{cid}/messages")
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 2 and {d.actor_id for d in denied} == {users.lead.id}
    assert {str(d.target_id) for d in denied} == {dm_id, "00000000-0000-0000-0000-000000000000"}
    assert all(d.detail["path"].startswith("/api/channels/") for d in denied)
    r = await client.get(f"/api/channels/{gid}/messages?limit=201")
    assert r.status_code == 422


async def test_new_user_joins_public_channels(client: AsyncClient, users: Users, app_db) -> None:
    """admin 이 만든 계정은 모든 공개 채널의 멤버가 된다(DM 은 아님)."""
    seeded = await _seed(app_db, users)
    await login(client, "jaeho@zenith.co.kr")
    r = await client.post(
        "/api/admin/users",
        json={"name": "신입", "email": "new@zenith.co.kr", "password": "zenith1234"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    new_id = r.json()["id"]
    rows = (
        (
            await app_db.execute(
                select(ChannelMember.channel_id).where(ChannelMember.user_id == new_id)
            )
        )
        .scalars()
        .all()
    )
    assert set(rows) == {seeded["general"].id, seeded["quiet"].id, seeded["others"].id}
    assert (await app_db.get(User, new_id)) is not None
