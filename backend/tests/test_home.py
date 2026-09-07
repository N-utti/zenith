"""04-API §2 홈·개인 — FR-HOM-01~05 · FR-SHL-04 · TC-BRD-01(홈 공지 마스킹) · TC-AUTH-04. 전부 실 Postgres."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.models import (
    Board,
    Channel,
    ChannelMember,
    Document,
    Folder,
    Message,
    Notification,
    Post,
    Todo,
    Workspace,
)

from .conftest import Users, csrf, login


async def _fixture(app_db, users: Users) -> dict:
    """문서 2 · 채널 2(하나는 DM) · 게시판 3 등급별 글 · 알림 · 할 일."""
    now = datetime.now(UTC)
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    sub = Folder(ws_id=ws.id, parent_id=root.id, title="브랜드")
    app_db.add(sub)
    await app_db.flush()
    old = Document(
        folder_id=root.id,
        title="오래된 문서",
        updated_by=users.lead.id,
        updated_at=now - timedelta(days=2),
    )
    new = Document(folder_id=sub.id, title="새 문서", updated_by=users.member.id, updated_at=now)
    trashed = Document(folder_id=root.id, title="지운 문서", deleted_at=now, updated_at=now)
    app_db.add_all([old, new, trashed])

    general = Channel(ws_id=ws.id, name="일반")
    dm = Channel(ws_id=ws.id, name="", is_dm=True)
    app_db.add_all([general, dm])
    await app_db.flush()
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
        ]
    )
    app_db.add_all(
        [
            Message(
                channel_id=general.id,
                author_id=users.lead.id,
                body="읽음",
                created_at=now - timedelta(hours=2),
            ),
            Message(
                channel_id=general.id,
                author_id=users.lead.id,
                body="안읽음1",
                created_at=now - timedelta(minutes=30),
            ),
            Message(
                channel_id=general.id,
                author_id=users.lead.id,
                body="안읽음2",
                created_at=now - timedelta(minutes=10),
            ),
            Message(
                channel_id=general.id,
                author_id=users.member.id,
                body="내가 쓴 건 안 셈",
                created_at=now,
            ),
            Message(channel_id=dm.id, author_id=users.exec.id, body="DM", created_at=now),
        ]
    )

    boards = {
        role: Board(name=name, min_role=role)
        for name, role in (("전체공지", "member"), ("팀장 회의록", "lead"), ("경영 보고", "exec"))
    }
    app_db.add_all(boards.values())
    await app_db.flush()
    app_db.add_all(
        [
            Post(
                board_id=boards["member"].id,
                title="전사 공지",
                body="b",
                author_id=users.exec.id,
                created_at=now - timedelta(hours=3),
            ),
            Post(
                board_id=boards["lead"].id,
                title="팀장 회의",
                body="b",
                author_id=users.lead.id,
                created_at=now - timedelta(hours=2),
            ),
            Post(
                board_id=boards["exec"].id,
                title="경영 숫자",
                body="b",
                author_id=users.exec.id,
                created_at=now - timedelta(hours=1),
            ),
            Post(
                board_id=boards["member"].id,
                title="네 번째",
                body="b",
                author_id=users.exec.id,
                created_at=now - timedelta(days=1),
            ),
        ]
    )
    app_db.add_all(
        [
            Notification(
                user_id=users.member.id,
                kind="mention",
                payload={"doc_id": str(new.id)},
                created_at=now - timedelta(minutes=5),
            ),
            Notification(
                user_id=users.member.id,
                kind="comment",
                payload={},
                read_at=now,
                created_at=now - timedelta(minutes=50),
            ),
            Notification(
                user_id=users.member.id, kind="post", payload={}, created_at=now
            ),  # 홈 피드엔 안 실림
            Notification(
                user_id=users.lead.id, kind="mention", payload={}, created_at=now
            ),  # 남의 것
        ]
    )
    app_db.add_all(
        [
            Todo(user_id=users.member.id, text="첫 할 일", created_at=now - timedelta(minutes=2)),
            Todo(
                user_id=users.member.id,
                text="둘째",
                done=True,
                created_at=now - timedelta(minutes=1),
            ),
            Todo(user_id=users.lead.id, text="남의 할 일", created_at=now),
        ]
    )
    await app_db.flush()
    return {"new": new, "general": general, "dm": dm}


async def test_home_requires_login(client: AsyncClient) -> None:
    assert (await client.get("/api/me/home")).status_code == 401


async def test_home_aggregates_for_member(client: AsyncClient, users: Users, app_db) -> None:
    ids = await _fixture(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/me/home")
    assert r.status_code == 200
    home = r.json()
    assert set(home) == {"recent_docs", "mentions", "unread", "posts", "todos"}

    # 이어서 작업: 내가 손댄 문서만, 최근순, 휴지통 제외, 경로 포함 (FR-HOM-01)
    assert [d["title"] for d in home["recent_docs"]] == ["새 문서"]
    assert home["recent_docs"][0]["path"] == ["회사 위키", "브랜드"]
    assert home["recent_docs"][0]["updated_by"]["name"] == "김수진"

    # 멘션&댓글: 내 것 · mention/comment/reply 만 · 최신순 (FR-HOM-02)
    assert [m["kind"] for m in home["mentions"]] == ["mention", "comment"]
    assert home["mentions"][0]["payload"]["doc_id"] == str(ids["new"].id)

    # 안 읽은 메시지: last_read_at 이후 · 내가 쓴 건 제외 · DM 은 상대 이름 (FR-HOM-03)
    unread = {u["name"]: u for u in home["unread"]}
    assert unread["일반"]["count"] == 2 and unread["일반"]["is_dm"] is False
    assert unread["최재호"]["count"] == 1 and unread["최재호"]["is_dm"] is True

    # 공지 3건 최신순, 권한 밖은 제목 마스킹 + 작성자 숨김 (FR-HOM-04 · TC-BRD-01)
    posts = home["posts"]
    assert [(p["board_name"], p["masked"]) for p in posts] == [
        ("경영 보고", True),
        ("팀장 회의록", True),
        ("전체공지", False),
    ]
    assert posts[0]["title"] == "＿＿＿＿＿ 보고" and posts[0]["author"] is None
    assert posts[2]["title"] == "전사 공지" and posts[2]["author"]["name"] == "최재호"
    assert {p["min_role"] for p in posts} == {"exec", "lead", "member"}

    # 할 일: 내 것만, 오래된 순 (FR-HOM-05)
    assert [(t["text"], t["done"]) for t in home["todos"]] == [("첫 할 일", False), ("둘째", True)]


async def test_home_falls_back_and_hides_foreign_channels(
    client: AsyncClient, users: Users, app_db
) -> None:
    """내가 손댄 문서가 없으면 전사 최근으로 채우고, 내가 없는 채널은 unread 에 나오지 않는다."""
    await _fixture(app_db, users)
    await login(client, "jaeho@zenith.co.kr")  # exec 은 문서를 편집한 적이 없다
    home = (await client.get("/api/me/home")).json()
    assert [d["title"] for d in home["recent_docs"]] == ["새 문서", "오래된 문서"]
    assert [u["name"] for u in home["unread"]] == []  # 일반 채널엔 없고, DM 은 본인이 보낸 것뿐
    assert home["todos"] == [] and home["mentions"] == []


async def test_home_empty_workspace(client: AsyncClient, users: Users) -> None:
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/me/home")
    assert r.status_code == 200
    assert r.json() == {"recent_docs": [], "mentions": [], "unread": [], "posts": [], "todos": []}
    assert r.headers["cache-control"] == "no-store"
    assert (await client.get("/api/me")).headers["cache-control"] == "no-store"


async def test_home_masking_follows_role(client: AsyncClient, users: Users, app_db) -> None:
    await _fixture(app_db, users)
    await login(client, "donghyun@zenith.co.kr")
    posts = (await client.get("/api/me/home")).json()["posts"]
    assert [p["masked"] for p in posts] == [True, False, False]
    await login(client, "jaeho@zenith.co.kr")
    posts = (await client.get("/api/me/home")).json()["posts"]
    assert [p["masked"] for p in posts] == [False, False, False]
    assert posts[0]["title"] == "경영 숫자"
    # 미지 role 은 승격이 아니라 전부 마스킹 (TC-SEC-05 · deps.require_role 과 같은 규약)
    users.exec.role = "admin"
    await app_db.flush()
    r = await client.get("/api/me/home")
    assert [p["masked"] for p in r.json()["posts"]] == [True, True, True]
    assert r.headers["cache-control"] == "no-store"


async def test_todos_crud_and_ownership(client: AsyncClient, users: Users, app_db) -> None:
    await _fixture(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.post("/api/me/todos", json={"text": "  예산안 회신 "}, headers=csrf(client))
    assert r.status_code == 201
    todo = r.json()
    assert (todo["text"], todo["done"]) == ("예산안 회신", False)
    assert set(todo) == {"id", "text", "done", "created_at"}
    assert (
        await client.post("/api/me/todos", json={"text": " "}, headers=csrf(client))
    ).status_code == 422

    r = await client.patch(f"/api/me/todos/{todo['id']}", json={"done": True}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["done"] is True
    r = await client.patch(f"/api/me/todos/{todo['id']}", json={"text": None}, headers=csrf(client))
    assert r.status_code == 422
    r = await client.patch(f"/api/me/todos/{todo['id']}", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["done"] is True  # 빈 본문은 아무것도 안 바꾼다
    assert [t["text"] for t in (await client.get("/api/me/todos")).json()["items"]] == [
        "첫 할 일",
        "둘째",
        "예산안 회신",
    ]

    # 남의 할 일은 없는 것과 같다 (TC-AUTH-04)
    others = [
        t
        for t in (await app_db.execute(Todo.__table__.select())).all()
        if t.user_id == users.lead.id
    ]
    other_id = others[0].id
    assert (
        await client.patch(f"/api/me/todos/{other_id}", json={"done": True}, headers=csrf(client))
    ).status_code == 404
    assert (
        await client.delete(f"/api/me/todos/{other_id}", headers=csrf(client))
    ).status_code == 404

    assert (
        await client.delete(f"/api/me/todos/{todo['id']}", headers=csrf(client))
    ).status_code == 204
    assert (
        await client.delete(f"/api/me/todos/{todo['id']}", headers=csrf(client))
    ).status_code == 404


async def test_notifications_list_and_read(client: AsyncClient, users: Users, app_db) -> None:
    await _fixture(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/me/notifications")
    assert r.status_code == 200
    items = r.json()["items"]
    assert [n["kind"] for n in items] == ["post", "mention", "comment"]  # 최신순, 내 것만
    assert set(items[0]) == {"id", "kind", "payload", "read_at", "created_at"}
    unread = (await client.get("/api/me/notifications", params={"unread": 1})).json()["items"]
    assert [n["kind"] for n in unread] == ["post", "mention"]

    # 읽음: 내 것만 바뀌고, 남의 id 는 조용히 무시된다
    theirs = (
        await app_db.execute(
            Notification.__table__.select().where(Notification.user_id == users.lead.id)
        )
    ).first()
    r = await client.post(
        "/api/me/notifications/read",
        json={"ids": [unread[0]["id"], str(theirs.id)]},
        headers=csrf(client),
    )
    assert r.status_code == 204
    unread = (await client.get("/api/me/notifications", params={"unread": 1})).json()["items"]
    assert [n["kind"] for n in unread] == ["mention"]
    assert (
        await app_db.execute(Notification.__table__.select().where(Notification.id == theirs.id))
    ).first().read_at is None
    assert (
        await client.post("/api/me/notifications/read", json={"ids": []}, headers=csrf(client))
    ).status_code == 422
    too_many = {"ids": [str(unread[0]["id"])] * 201}
    assert (
        await client.post("/api/me/notifications/read", json=too_many, headers=csrf(client))
    ).status_code == 422
    assert (await client.get("/api/me/notifications", params={"limit": 0})).status_code == 422
