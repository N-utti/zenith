"""04-API §3 문서 트리·문서 — FR-DOC-03~05 · TC-DOC-05·06·07 · TC-AUTH-04. 전부 실 Postgres."""

import base64
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app import audit
from app.models import (
    Channel,
    DocChunk,
    DocComment,
    DocVersion,
    Folder,
    Message,
    Notification,
    User,
    Workspace,
)

from .conftest import Users, csrf, login

SNAP = base64.b64encode(b"\x00\x01yjs-snapshot").decode()


async def _root(app_db) -> Folder:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    return root


async def _doc(client: AsyncClient, folder_id, title: str = "기획서") -> dict:
    r = await client.post(
        "/api/docs", json={"folder_id": str(folder_id), "title": title}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_docs_require_login(client: AsyncClient) -> None:
    assert (await client.get("/api/tree")).status_code == 401


async def test_folders_and_tree(client: AsyncClient, users: Users, app_db) -> None:
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")

    r = await client.post(
        "/api/folders",
        json={"title": " 브랜드 ", "parent_id": str(root.id), "sort": 2},
        headers=csrf(client),
    )
    assert r.status_code == 201
    brand = r.json()
    assert (brand["title"], brand["parent_id"], brand["sort"]) == ("브랜드", str(root.id), 2)
    r = await client.post(
        "/api/folders", json={"title": "하위", "parent_id": brand["id"]}, headers=csrf(client)
    )
    sub = r.json()

    # 없는 부모는 500(외래키)이 아니라 422
    r = await client.post(
        "/api/folders",
        json={"title": "x", "parent_id": "00000000-0000-0000-0000-000000000000"},
        headers=csrf(client),
    )
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    # 순환: 브랜드를 자기 하위로
    r = await client.patch(
        f"/api/folders/{brand['id']}", json={"parent_id": sub["id"]}, headers=csrf(client)
    )
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    r = await client.patch(
        f"/api/folders/{brand['id']}", json={"parent_id": brand["id"]}, headers=csrf(client)
    )
    assert r.status_code == 422
    # 정상 이동·이름
    r = await client.patch(
        f"/api/folders/{sub['id']}",
        json={"parent_id": str(root.id), "title": "이동됨"},
        headers=csrf(client),
    )
    assert r.status_code == 200
    assert (r.json()["parent_id"], r.json()["title"]) == (str(root.id), "이동됨")
    assert (
        await client.patch(
            "/api/folders/00000000-0000-0000-0000-000000000000",
            json={"title": "x"},
            headers=csrf(client),
        )
    ).status_code == 404

    doc = await _doc(client, root.id, "회사 소개")
    await _doc(client, brand["id"], "브랜드 가이드")
    r = await client.get("/api/tree")
    assert r.status_code == 200
    tree = r.json()
    # 같은 부모 안에서는 sort 순 — 이동됨(0) 이 브랜드(2) 보다 앞
    assert [f["title"] for f in tree["folders"]] == ["회사 위키", "이동됨", "브랜드"]
    assert [d["title"] for d in tree["docs"]] == ["브랜드 가이드", "회사 소개"]  # 제목순
    assert tree["docs"][0]["updated_by"] == {"id": str(users.member.id), "name": "김수진"}
    assert set(doc) == {"id", "folder_id", "title", "updated_at", "updated_by", "deleted_at"}


async def test_doc_create_read_update(client: AsyncClient, users: Users, app_db) -> None:
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        "/api/docs", json={"folder_id": str(root.id), "title": " "}, headers=csrf(client)
    )
    assert r.status_code == 422
    r = await client.post(
        "/api/docs",
        json={"folder_id": "00000000-0000-0000-0000-000000000000", "title": "x"},
        headers=csrf(client),
    )
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")

    doc = await _doc(client, root.id, " 기획서 ")
    assert doc["title"] == "기획서"
    r = await client.get(f"/api/docs/{doc['id']}")
    assert r.status_code == 200
    assert r.json()["ydoc"] is None  # /yjs 릴레이가 붙기 전
    assert r.json()["updated_by"]["name"] == "김수진"

    # 다른 사람이 제목을 고치면 updated_by 가 바뀌고 updated_at 이 앞으로 간다
    before = datetime.fromisoformat(doc["updated_at"])
    await login(client, "donghyun@zenith.co.kr")
    r = await client.patch(
        f"/api/docs/{doc['id']}", json={"title": "기획서 v2"}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert r.json()["title"] == "기획서 v2"
    assert r.json()["updated_by"]["name"] == "박동현"
    assert datetime.fromisoformat(r.json()["updated_at"]) >= before
    assert (
        await client.patch(f"/api/docs/{doc['id']}", json={"title": ""}, headers=csrf(client))
    ).status_code == 422
    assert (await client.get("/api/docs/00000000-0000-0000-0000-000000000000")).status_code == 404


async def test_trash_untrash_and_hard_delete(client: AsyncClient, users: Users, app_db) -> None:
    """TC-DOC-05 휴지통 복구 · TC-AUTH-04 권한 밖 영구 삭제 403 + 감사."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)
    await client.post(
        f"/api/docs/{doc['id']}/comments", json={"body": "남는 댓글"}, headers=csrf(client)
    )

    r = await client.delete(f"/api/docs/{doc['id']}", headers=csrf(client))
    assert r.status_code == 204
    assert (await client.get("/api/tree")).json()["docs"] == []
    r = await client.get(f"/api/docs/{doc['id']}")  # 휴지통에 있어도 열린다
    assert r.status_code == 200 and r.json()["deleted_at"] is not None
    # 휴지통 문서는 고칠 수 없다
    assert (
        await client.patch(f"/api/docs/{doc['id']}", json={"title": "x"}, headers=csrf(client))
    ).status_code == 404

    r = await client.post(f"/api/docs/{doc['id']}/untrash", headers=csrf(client))
    assert r.status_code == 200 and r.json()["deleted_at"] is None
    assert [d["id"] for d in (await client.get("/api/tree")).json()["docs"]] == [doc["id"]]
    assert len((await client.get(f"/api/docs/{doc['id']}/comments")).json()["items"]) == 1

    # member 의 영구 삭제는 403 + acl.denied
    r = await client.delete(f"/api/docs/{doc['id']}", params={"hard": 1}, headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert await audit.count_since(app_db, "acl.denied", since, min_role="exec") == 1
    assert (await client.get(f"/api/docs/{doc['id']}")).status_code == 200

    await login(client, "jaeho@zenith.co.kr")
    r = await client.delete(f"/api/docs/{doc['id']}", params={"hard": 1}, headers=csrf(client))
    assert r.status_code == 204
    assert (await client.get(f"/api/docs/{doc['id']}")).status_code == 404
    assert await audit.count_since(app_db, "docs.hard_deleted", since) == 1


async def test_missing_doc_paths_are_404(client: AsyncClient, users: Users, app_db) -> None:
    await login(client, "sujin@zenith.co.kr")
    ghost = "/api/docs/00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"{ghost}/versions")).status_code == 404
    assert (await client.get(f"{ghost}/comments")).status_code == 404
    r = await client.post(f"{ghost}/versions", json={"snapshot": SNAP}, headers=csrf(client))
    assert r.status_code == 404
    assert (await client.post(f"{ghost}/untrash", headers=csrf(client))).status_code == 404
    assert (await client.delete(ghost, headers=csrf(client))).status_code == 404


async def test_hard_delete_cascades(client: AsyncClient, users: Users, app_db) -> None:
    """버전·댓글·색인은 지워지고, 채팅의 문서 카드는 본문을 남긴 채 참조만 풀린다."""
    root = await _root(app_db)
    await login(client, "jaeho@zenith.co.kr")
    doc = await _doc(client, root.id)
    await client.post(
        f"/api/docs/{doc['id']}/versions", json={"snapshot": SNAP}, headers=csrf(client)
    )
    await client.post(f"/api/docs/{doc['id']}/comments", json={"body": "c"}, headers=csrf(client))
    ch = Channel(ws_id=root.ws_id, name="일반")
    app_db.add(ch)
    await app_db.flush()
    msg = Message(channel_id=ch.id, author_id=users.exec.id, body="문서 카드", doc_ref=doc["id"])
    app_db.add_all([msg, DocChunk(doc_id=doc["id"], chunk_no=0, chunk_text="t", acl_role="member")])
    await app_db.flush()

    r = await client.delete(f"/api/docs/{doc['id']}", params={"hard": 1}, headers=csrf(client))
    assert r.status_code == 204
    for model in (DocVersion, DocComment, DocChunk):
        rows = (await app_db.execute(select(model).where(model.doc_id == doc["id"]))).all()
        assert rows == [], model.__tablename__
    await app_db.refresh(msg)
    assert (msg.doc_ref, msg.body) == (None, "문서 카드")


async def test_empty_patch_is_a_noop(client: AsyncClient, users: Users, app_db) -> None:
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)
    await login(client, "donghyun@zenith.co.kr")
    r = await client.patch(f"/api/docs/{doc['id']}", json={}, headers=csrf(client))
    assert r.status_code == 200
    assert (r.json()["updated_at"], r.json()["updated_by"]["name"]) == (doc["updated_at"], "김수진")


async def test_review_followups(client: AsyncClient, users: Users, app_db) -> None:
    """리뷰 후속 — 휴지통 문서에 쓰기 404 · null 은 422 · 길이 상한 422 · 동명이인 멘션."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)

    # PATCH 의 null 은 DB 409 가 아니라 422 (parent_id 의 null 은 루트 이동이라 허용)
    r = await client.patch(f"/api/docs/{doc['id']}", json={"title": None}, headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    r = await client.post(
        "/api/folders", json={"title": "f", "parent_id": str(root.id)}, headers=csrf(client)
    )
    folder = r.json()
    for body in ({"title": None}, {"sort": None}):
        r = await client.patch(f"/api/folders/{folder['id']}", json=body, headers=csrf(client))
        assert r.status_code == 422, body
    r = await client.patch(
        f"/api/folders/{folder['id']}", json={"parent_id": None}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["parent_id"] is None

    # 길이 상한
    assert (
        await client.post(
            "/api/docs", json={"folder_id": str(root.id), "title": "x" * 201}, headers=csrf(client)
        )
    ).status_code == 422
    url = f"/api/docs/{doc['id']}/comments"
    r = await client.post(url, json={"body": "y" * 10_001, "block_id": "b"}, headers=csrf(client))
    assert r.status_code == 422
    r = await client.post(url, json={"body": "ok", "block_id": "b" * 101}, headers=csrf(client))
    assert r.status_code == 422

    # 휴지통 문서에는 댓글·버전을 남길 수 없다. 누가 넣었는지는 updated_by 에 남는다
    await login(client, "donghyun@zenith.co.kr")
    assert (await client.delete(f"/api/docs/{doc['id']}", headers=csrf(client))).status_code == 204
    assert (await client.get(f"/api/docs/{doc['id']}")).json()["updated_by"]["name"] == "박동현"
    assert (await client.post(url, json={"body": "x"}, headers=csrf(client))).status_code == 404
    r = await client.post(
        f"/api/docs/{doc['id']}/versions", json={"snapshot": SNAP}, headers=csrf(client)
    )
    assert r.status_code == 404

    # 동명이인: 글쓴이와 같은 이름의 다른 사용자도 알림을 받는다
    await login(client, "sujin@zenith.co.kr")
    twin = User(name="김수진", email="twin@zenith.co.kr", pw_hash="", role="member", active=True)
    app_db.add(twin)
    await app_db.flush()
    other = await _doc(client, root.id, "둘째")
    r = await client.post(
        f"/api/docs/{other['id']}/comments", json={"body": "@김수진 보세요"}, headers=csrf(client)
    )
    assert r.status_code == 201
    notes = list((await app_db.execute(select(Notification))).scalars())
    assert [n.user_id for n in notes] == [twin.id]


async def test_versions_coalesce_label_and_restore(
    client: AsyncClient, users: Users, app_db
) -> None:
    """TC-DOC-07. 같은 사람의 무명 스냅샷은 3분 안에 하나로 접히고, 라벨이 붙으면 접히지 않는다."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)
    url = f"/api/docs/{doc['id']}/versions"

    r = await client.post(url, json={"snapshot": "not base64!!"}, headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")

    r = await client.post(url, json={"snapshot": SNAP}, headers=csrf(client))
    assert r.status_code == 201
    v1 = r.json()
    assert set(v1) == {"id", "created_at", "author", "label", "snapshot"}
    assert (v1["author"]["name"], v1["label"], v1["snapshot"]) == ("김수진", None, SNAP)

    snap2 = base64.b64encode(b"second").decode()
    r = await client.post(url, json={"snapshot": snap2}, headers=csrf(client))
    assert r.status_code == 201
    assert r.json()["id"] == v1["id"]  # 접혔다
    assert r.json()["snapshot"] == snap2

    r = await client.post(
        url, json={"snapshot": SNAP, "label": "되돌리기 전"}, headers=csrf(client)
    )
    labeled = r.json()
    assert labeled["id"] != v1["id"] and labeled["label"] == "되돌리기 전"
    # 라벨 뒤의 무명 스냅샷은 라벨 버전에 접히지 않는다
    r = await client.post(url, json={"snapshot": snap2}, headers=csrf(client))
    v3 = r.json()
    assert v3["id"] not in (v1["id"], labeled["id"])

    # 다른 사람의 스냅샷은 접히지 않는다
    await login(client, "donghyun@zenith.co.kr")
    r = await client.post(url, json={"snapshot": SNAP}, headers=csrf(client))
    v4 = r.json()
    assert v4["id"] != v3["id"] and v4["author"]["name"] == "박동현"

    # 3분이 지난 무명 스냅샷도 접히지 않는다
    row = await app_db.get(DocVersion, v4["id"])
    row.created_at = datetime.now(UTC) - timedelta(minutes=4)
    await app_db.flush()
    r = await client.post(url, json={"snapshot": snap2}, headers=csrf(client))
    v5 = r.json()
    assert v5["id"] != v4["id"]

    r = await client.get(url)
    assert set(r.json()["items"][0]) == {
        "id",
        "created_at",
        "author",
        "label",
    }  # 스냅샷은 목록에 없다
    ids = [v["id"] for v in r.json()["items"]]
    # 최신순. v4 는 위에서 4분 전으로 되돌렸으니 맨 뒤, v1 은 접힐 때 시각이 갱신돼 라벨 버전보다 앞이다
    assert ids == [v5["id"], v3["id"], labeled["id"], v1["id"], v4["id"]]

    r = await client.post(
        f"/api/docs/{doc['id']}/restore", json={"version_id": labeled["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert (r.json()["id"], r.json()["snapshot"]) == (labeled["id"], SNAP)
    other = await _doc(client, root.id, "다른 문서")
    r = await client.post(
        f"/api/docs/{other['id']}/restore", json={"version_id": labeled["id"]}, headers=csrf(client)
    )
    assert r.status_code == 404  # 남의 문서 버전은 복구할 수 없다
    r = await client.post(
        f"/api/docs/{doc['id']}/restore",
        json={"version_id": "00000000-0000-0000-0000-000000000000"},
        headers=csrf(client),
    )
    assert r.status_code == 404
    assert len(await select_versions(app_db, doc["id"])) == 5


async def select_versions(app_db, doc_id: str) -> list[DocVersion]:
    return list(
        (await app_db.execute(select(DocVersion).where(DocVersion.doc_id == doc_id))).scalars()
    )


async def test_comments_and_mentions(client: AsyncClient, users: Users, app_db) -> None:
    """TC-DOC-06: @이름 멘션 → 대상자 notifications 행. 자기 멘션은 알림 없음."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)
    url = f"/api/docs/{doc['id']}/comments"

    assert (await client.post(url, json={"body": "  "}, headers=csrf(client))).status_code == 422
    r = await client.post(
        url,
        json={"block_id": "b-1", "body": "@박동현 @김수진 @없는사람 확인 부탁해요."},
        headers=csrf(client),
    )
    assert r.status_code == 201
    c = r.json()
    assert set(c) == {"id", "block_id", "author", "body", "created_at"}
    assert (c["block_id"], c["author"]["name"]) == ("b-1", "김수진")
    await client.post(url, json={"body": "두 번째"}, headers=csrf(client))

    r = await client.get(url)
    assert [x["body"] for x in r.json()["items"]][1] == "두 번째"  # 오래된 순

    notes = list((await app_db.execute(select(Notification))).scalars())
    assert [(n.user_id, n.kind) for n in notes] == [(users.lead.id, "mention")]
    assert notes[0].payload["doc_id"] == doc["id"]
    assert notes[0].payload["comment_id"] == c["id"]
    assert notes[0].payload["from"]["name"] == "김수진"
    assert notes[0].read_at is None

    assert (
        await client.post(
            "/api/docs/00000000-0000-0000-0000-000000000000/comments",
            json={"body": "x"},
            headers=csrf(client),
        )
    ).status_code == 404
