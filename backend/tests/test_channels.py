"""04-API §5 채팅 REST — FR-CHT-01·03 · TC-CHT-02(배지 일치) · TC-AUTH-04(남의 채널)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select

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
    secret = Channel(ws_id=ws.id, name="인사", is_dm=False, is_private=True)  # 임원만
    app_db.add_all([general, dm, quiet, others, secret])
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
            ChannelMember(channel_id=secret.id, user_id=users.exec.id),
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
    return {
        "general": general,
        "dm": dm,
        "quiet": quiet,
        "others": others,
        "ws": ws,
        "secret": secret,
    }


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
    """admin 이 만든 계정은 모든 공개 채널의 멤버가 된다(DM·비공개는 아님)."""
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


async def _pushes(monkeypatch) -> list[tuple[set, dict]]:
    """`channels` 이벤트가 누구에게 갔는지 — 소켓 대신 push 를 가로챈다."""
    sent: list[tuple[set, dict]] = []

    async def fake(user_ids, event, *, exclude=None):
        sent.append((set(user_ids), event))

    monkeypatch.setattr("app.realtime.chat.push", fake)
    return sent


async def test_private_channel_create(
    client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """비공개는 만든 사람+고른 사람만 멤버·멤버에게만 보인다. 두 칸은 같이 와야 하고(422), 이름 중복은 공개끼리만(409)."""
    await _seed(app_db, users)
    sent = await _pushes(monkeypatch)
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    # 한쪽만·모양 틀림·DM 에 끼움 → 전부 422, 채널은 하나도 안 생긴다(조용한 공개 금지)
    before = (await app_db.execute(select(func.count()).select_from(Channel))).scalar_one()
    for bad in (
        {"name": "실사", "member_ids": [str(users.lead.id)]},
        {"name": "실사", "is_private": True},
        {"name": "실사", "is_private": "true", "member_ids": []},
        {"name": "실사", "is_private": False, "member_ids": []},
        {"dm_user_id": str(users.lead.id), "is_private": True, "member_ids": []},
        {"name": "실사", "is_private": True, "member_ids": [str(uuid.uuid4())]},
        {
            "name": "실사",
            "isPrivate": True,
            "memberIds": [],
        },  # 칸 이름을 틀려도 공개 채널이 되지 않는다
        {"name": "실사", "is_private": None},  # 참·거짓이 아니면 422
    ):
        r = await client.post("/api/channels", json=bad, headers=h)
        assert r.status_code == 422, (bad, r.text)
    users.exec.active = False
    await app_db.flush()
    r = await client.post(
        "/api/channels",
        json={"name": "실사", "is_private": True, "member_ids": [str(users.exec.id)]},
        headers=h,
    )
    assert r.status_code == 422  # 비활성은 DM 상대와 같은 규칙
    users.exec.active = True
    await app_db.flush()
    assert (await app_db.execute(select(func.count()).select_from(Channel))).scalar_one() == before
    assert sent == []

    r = await client.post(
        "/api/channels",
        json={"name": "실사", "is_private": True, "member_ids": [str(users.lead.id)]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    private = r.json()
    assert private["is_private"] and not private["is_dm"]
    assert {m["name"] for m in private["members"]} == {"김수진", "박동현"}
    assert sent == [({users.member.id, users.lead.id}, {"ev": "channels"})]
    # 빈 명단 = 혼자인 채널(나중에 더한다). 비공개는 같은 이름이라도 409 가 아니다
    r = await client.post(
        "/api/channels", json={"name": "실사", "is_private": True, "member_ids": []}, headers=h
    )
    assert r.status_code == 201 and len(r.json()["members"]) == 1
    # 비공개와 같은 이름의 공개 채널도 409 없이 — 안 보이는 채널의 존재가 새지 않는다
    r = await client.post("/api/channels", json={"name": "실사"}, headers=h)
    assert r.status_code == 201 and r.json()["is_private"] is False
    r = await client.post("/api/channels", json={"name": "실사"}, headers=h)
    assert r.status_code == 409  # 공개끼리는 그대로 409

    mine = (await client.get("/api/channels")).json()["items"]
    assert sum(c["name"] == "실사" for c in mine) == 3
    assert all(c["is_private"] is False for c in mine if c["is_dm"])
    await login(client, "jaeho@zenith.co.kr")  # 임원도 멤버가 아니면 못 본다
    theirs = (await client.get("/api/channels")).json()["items"]
    assert [c["is_private"] for c in theirs if c["name"] == "실사"] == [False]
    r = await client.get(f"/api/channels/{private['id']}/messages")
    assert r.status_code == 403
    await login(client, "sujin@zenith.co.kr")
    home = (await client.get("/api/me/home")).json()
    assert {u["name"]: u["is_private"] for u in home["unread"]} == {"일반": False, "최재호": False}


async def test_private_channel_members(
    client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """멤버면 누구나 더하고 뺀다. 공개·DM 은 422, 비멤버 요청 403, 뺄 사람이 멤버 아니면 404. 전·후 멤버에게 channels 이벤트."""
    seeded = await _seed(app_db, users)
    sent = await _pushes(monkeypatch)
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    r = await client.post(
        "/api/channels",
        json={"name": "실사", "is_private": True, "member_ids": [str(users.lead.id)]},
        headers=h,
    )
    cid = r.json()["id"]
    sent.clear()
    # 공개·DM 에는 422
    for fixed in (seeded["general"].id, seeded["dm"].id):
        r = await client.post(
            f"/api/channels/{fixed}/members", json={"user_ids": [str(users.lead.id)]}, headers=h
        )
        assert r.status_code == 422, r.text
        r = await client.delete(f"/api/channels/{fixed}/members/{users.member.id}", headers=h)
        assert r.status_code == 422
    # 빈 명단·없는 사람 → 422
    r = await client.post(f"/api/channels/{cid}/members", json={"user_ids": []}, headers=h)
    assert r.status_code == 422
    r = await client.post(
        f"/api/channels/{cid}/members", json={"user_ids": [str(uuid.uuid4())]}, headers=h
    )
    assert r.status_code == 422
    assert sent == []

    # 임원(비멤버)이 자기를 끼우려 하면 403 + 감사 — 없는 채널과 같은 답
    await login(client, "jaeho@zenith.co.kr")
    h2 = csrf(client)
    for target in (cid, uuid.uuid4()):
        r = await client.post(
            f"/api/channels/{target}/members", json={"user_ids": [str(users.exec.id)]}, headers=h2
        )
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 2 and {d.actor_id for d in denied} == {users.exec.id}
    assert sent == []

    # 팀장(멤버)이 임원을 더한다 — 이미 멤버인 자신이 섞여도 건너뛴다
    await login(client, "donghyun@zenith.co.kr")
    h3 = csrf(client)
    r = await client.post(
        f"/api/channels/{cid}/members",
        json={"user_ids": [str(users.exec.id), str(users.lead.id)]},
        headers=h3,
    )
    assert r.status_code == 200, r.text
    assert {m["name"] for m in r.json()["members"]} == {"김수진", "박동현", "최재호"}
    assert r.json()["is_private"] is True
    assert sent == [({users.member.id, users.lead.id, users.exec.id}, {"ev": "channels"})]
    sent.clear()
    r = await client.post(
        f"/api/channels/{cid}/members", json={"user_ids": [str(users.exec.id)]}, headers=h3
    )
    assert r.status_code == 200 and len(r.json()["members"]) == 3 and sent == []  # 변화 없음

    # 이제 임원은 멤버 — 목록에 보이고 메시지도 읽는다
    await login(client, "jaeho@zenith.co.kr")
    h2 = csrf(client)  # 다시 로그인했으니 CSRF 쿠키도 새것
    assert cid in {c["id"] for c in (await client.get("/api/channels")).json()["items"]}
    assert (await client.get(f"/api/channels/{cid}/messages")).status_code == 200
    # 멤버 아닌 사람 빼기 → 404. 남 빼기: 빠진 사람도 이벤트를 받는다
    r = await client.delete(f"/api/channels/{cid}/members/{uuid.uuid4()}", headers=h2)
    assert r.status_code == 404
    r = await client.delete(f"/api/channels/{cid}/members/{users.lead.id}", headers=h2)
    assert r.status_code == 204
    assert sent == [({users.member.id, users.lead.id, users.exec.id}, {"ev": "channels"})]
    sent.clear()
    # 자기 자신 빼기 = 나가기
    r = await client.delete(f"/api/channels/{cid}/members/{users.exec.id}", headers=h2)
    assert r.status_code == 204
    assert sent == [({users.member.id, users.exec.id}, {"ev": "channels"})]
    assert cid not in {c["id"] for c in (await client.get("/api/channels")).json()["items"]}
    assert (await client.get(f"/api/channels/{cid}/messages")).status_code == 403
    r = await client.delete(f"/api/channels/{cid}/members/{users.member.id}", headers=h2)
    assert r.status_code == 403  # 나간 뒤에는 남을 빼지 못한다
    await login(client, "donghyun@zenith.co.kr")
    assert cid not in {c["id"] for c in (await client.get("/api/channels")).json()["items"]}

    # `at` 은 트랜잭션 시각이라 테스트 안에서는 전부 같다 — 순서가 아니라 집합으로 본다
    changes = (
        (
            await app_db.execute(
                select(AuditEvent).where(AuditEvent.kind == "channels.members_changed")
            )
        )
        .scalars()
        .all()
    )
    assert sorted(
        (str(c.actor_id), json.dumps(c.detail, sort_keys=True)) for c in changes
    ) == sorted(
        (str(actor), json.dumps(detail, sort_keys=True))
        for actor, detail in (
            (
                users.member.id,
                {"created": True, "added": sorted(str(u.id) for u in (users.member, users.lead))},
            ),
            (users.lead.id, {"added": [str(users.exec.id)]}),
            (users.exec.id, {"removed": [str(users.lead.id)]}),
            (users.exec.id, {"removed": [str(users.exec.id)]}),
        )
    )


async def test_rename_channel(client: AsyncClient, users: Users, app_db, monkeypatch) -> None:
    """이슈 #268: 멤버면 누구나 이름을 바꾼다. DM 422, 남의 채널 403+감사, 공개끼리 중복 409(비공개는 허용)."""
    seeded = await _seed(app_db, users)
    sent = await _pushes(monkeypatch)
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    url = f"/api/channels/{seeded['general'].id}"
    r = await client.patch(url, json={"name": "  공지  "}, headers=h)
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["id"]) == ("공지", str(seeded["general"].id))
    assert sent == [({users.member.id, users.lead.id}, {"ev": "channels"})]
    ev = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "channels.renamed"))
    ).scalar_one()
    assert (ev.actor_id, ev.detail) == (users.member.id, {"from": "일반", "to": "공지"})
    assert [i["name"] for i in (await client.get("/api/channels")).json()["items"]][0] == "공지"
    # 그대로면 200 이지만 이벤트도 감사도 더 없다
    assert (await client.patch(url, json={"name": "공지"}, headers=h)).status_code == 200
    assert len(sent) == 1
    # 다른 공개 채널의 이름 → 409 · 빈 이름·모르는 칸 → 422 · DM → 422
    assert (await client.patch(url, json={"name": "조용"}, headers=h)).status_code == 409
    assert (await client.patch(url, json={"name": "  "}, headers=h)).status_code == 422
    assert (
        await client.patch(url, json={"name": "x", "is_dm": True}, headers=h)
    ).status_code == 422
    r = await client.patch(f"/api/channels/{seeded['dm'].id}", json={"name": "x"}, headers=h)
    assert r.status_code == 422
    # 멤버 아닌 채널은 없는 채널과 같은 403 + acl.denied
    r = await client.patch(f"/api/channels/{seeded['others'].id}", json={"name": "x"}, headers=h)
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    denied = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied"))
    ).scalar_one()
    assert denied.target_id == seeded["others"].id
    # 비공개 채널은 공개 채널과 같은 이름이라도 된다
    await login(client, "jaeho@zenith.co.kr")
    r = await client.patch(
        f"/api/channels/{seeded['secret'].id}", json={"name": "조용"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["is_private"]


async def test_hide_dm(client: AsyncClient, users: Users, app_db, monkeypatch) -> None:
    """이슈 #268: DM 만 숨긴다(채널 422). 내 목록·홈에서만 빠지고 상대는 그대로. 같은 상대와 다시 열면 돌아온다."""
    seeded = await _seed(app_db, users)
    sent = await _pushes(monkeypatch)
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    dm_id = str(seeded["dm"].id)
    r = await client.post(f"/api/channels/{seeded['general'].id}/hide", headers=h)
    assert r.status_code == 422
    r = await client.post(f"/api/channels/{seeded['others'].id}/hide", headers=h)
    assert r.status_code == 403
    r = await client.post(f"/api/channels/{dm_id}/hide", headers=h)
    assert (r.status_code, r.content) == (204, b"")
    assert sent == [({users.member.id}, {"ev": "channels"})]
    assert [i["name"] for i in (await client.get("/api/channels")).json()["items"]] == [
        "일반",
        "조용",
    ]
    home = (await client.get("/api/me/home")).json()
    assert [u["channel_id"] for u in home["unread"]] == [str(seeded["general"].id)]
    # 메시지는 그대로 읽힌다(멤버십은 안 바뀐다)
    assert (await client.get(f"/api/channels/{dm_id}/messages")).status_code == 200
    # 상대의 목록에는 그대로
    await login(client, "jaeho@zenith.co.kr")
    assert dm_id in [i["id"] for i in (await client.get("/api/channels")).json()["items"]]
    # 같은 상대와 DM 을 다시 열면 그 방이 돌아온다
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        "/api/channels", json={"dm_user_id": str(users.exec.id)}, headers=csrf(client)
    )
    assert (r.status_code, r.json()["id"]) == (201, dm_id)
    assert dm_id in [i["id"] for i in (await client.get("/api/channels")).json()["items"]]


async def test_member_change_locks_before_membership_check(
    client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """H1: 요청자가 멤버 확인을 통과한 뒤 빠지면 안 된다 — 잠금이 확인보다 먼저라, 잠금을 기다리는 동안
    다른 트랜잭션이 요청자를 빼고 commit 했으면 늦게 들어온 요청은 403 이다(되살아나지 않는다).
    공유 세션은 커넥션이 하나라 진짜 두 트랜잭션을 못 돌린다 — 잠금을 얻은 직후에 그 상황을 흉내낸다."""
    from sqlalchemy import delete

    from app.routers import channels as mod

    await _seed(app_db, users)
    await _pushes(monkeypatch)
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    r = await client.post(
        "/api/channels",
        json={"name": "실사", "is_private": True, "member_ids": [str(users.lead.id)]},
        headers=h,
    )
    cid = uuid.UUID(r.json()["id"])
    real_lock = mod._lock_channel

    async def lock_then_requester_was_removed(db, channel_id):
        await real_lock(db, channel_id)
        await db.execute(
            delete(ChannelMember).where(
                ChannelMember.channel_id == channel_id, ChannelMember.user_id == users.member.id
            )
        )

    monkeypatch.setattr(mod, "_lock_channel", lock_then_requester_was_removed)
    r = await client.post(
        f"/api/channels/{cid}/members",
        json={"user_ids": [str(users.member.id), str(users.exec.id)]},
        headers=h,
    )
    assert r.status_code == 403, r.text
    members = (
        await app_db.execute(select(ChannelMember.user_id).where(ChannelMember.channel_id == cid))
    ).scalars()
    assert set(members) == {users.lead.id}  # 요청자는 되살아나지 않고 임원도 안 들어갔다
