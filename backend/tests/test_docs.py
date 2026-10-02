"""04-API §3 문서 트리·문서 — FR-DOC-03~05 · TC-DOC-05·06·07 · TC-AUTH-04. 전부 실 Postgres."""

import base64
import re
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import event, select
from sqlalchemy.engine import Engine

from app import audit
from app.models import (
    AuditEvent,
    Channel,
    DocChunk,
    DocComment,
    Document,
    DocVersion,
    Folder,
    Message,
    Notification,
    StoredFile,
    User,
    Workspace,
)
from app.routers.docs import purge_trash

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
    assert (await client.get("/api/trash")).status_code == 401


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
    # 등급 이름은 화면 표기대로 — 프론트가 서버 문구를 그대로 띄운다
    assert "임원" in r.json()["detail"]
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert await audit.count_since(app_db, "acl.denied", since, min_role="exec") == 1
    assert (await client.get(f"/api/docs/{doc['id']}")).status_code == 200

    await login(client, "jaeho@zenith.co.kr")
    r = await client.delete(f"/api/docs/{doc['id']}", params={"hard": 1}, headers=csrf(client))
    assert r.status_code == 204
    assert (await client.get(f"/api/docs/{doc['id']}")).status_code == 404
    assert await audit.count_since(app_db, "docs.hard_deleted", since) == 1


async def test_trash_list(client: AsyncClient, users: Users, app_db) -> None:
    """휴지통 목록 — 지운 지 최근 순, 되돌리면 빠진다. 트리와 정확히 반대집합."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    keep = await _doc(client, root.id, "남는 문서")
    first = await _doc(client, root.id, "먼저 지운 문서")
    second = await _doc(client, root.id, "나중에 지운 문서")

    assert (await client.get("/api/trash")).json()["items"] == []  # 지운 게 없으면 빈 목록
    assert (
        await client.delete(f"/api/docs/{first['id']}", headers=csrf(client))
    ).status_code == 204
    await login(client, "donghyun@zenith.co.kr")  # 만든 사람과 지운 사람을 갈라 둔다
    assert (
        await client.delete(f"/api/docs/{second['id']}", headers=csrf(client))
    ).status_code == 204

    items = (await client.get("/api/trash")).json()["items"]
    assert [d["title"] for d in items] == ["나중에 지운 문서", "먼저 지운 문서"]  # 최근 삭제 순
    assert items[0]["deleted_at"] is not None
    assert items[0]["updated_by"]["name"] == "박동현"  # 만든 사람이 아니라 지운 사람
    assert items[1]["updated_by"]["name"] == "김수진"
    assert [d["id"] for d in (await client.get("/api/tree")).json()["docs"]] == [keep["id"]]

    assert len((await client.get("/api/trash", params={"limit": 1})).json()["items"]) == 1
    for bad in (0, 501):
        assert (await client.get("/api/trash", params={"limit": bad})).status_code == 422

    await client.post(f"/api/docs/{second['id']}/untrash", headers=csrf(client))
    assert [d["id"] for d in (await client.get("/api/trash")).json()["items"]] == [first["id"]]


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
    f = StoredFile(
        name="a.pdf",
        size=1,
        content_type="application/octet-stream",
        uploader_id=users.exec.id,
        doc_id=doc["id"],
    )
    app_db.add_all(
        [msg, f, DocChunk(doc_id=doc["id"], chunk_no=0, chunk_text="t", acl_role="member")]
    )
    await app_db.flush()

    r = await client.delete(f"/api/docs/{doc['id']}", params={"hard": 1}, headers=csrf(client))
    assert r.status_code == 204
    for model in (DocVersion, DocComment, DocChunk):
        rows = (await app_db.execute(select(model).where(model.doc_id == doc["id"]))).all()
        assert rows == [], model.__tablename__
    await app_db.refresh(msg)
    assert (msg.doc_ref, msg.body) == (None, "문서 카드")
    await app_db.refresh(f)
    assert (f.doc_id, f.name) == (None, "a.pdf")  # 파일 기록부는 출처만 풀린다(FK 에 막히지 않는다)


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


async def test_delete_comment_author_only(client: AsyncClient, users: Users, app_db) -> None:
    """이슈 #253: 쓴 사람만 지운다(남의 것 403 + acl.denied). 멘션 알림도 같이 사라지고, 휴지통 문서는 404."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id)
    url = f"/api/docs/{doc['id']}/comments"
    mine = (await client.post(url, json={"body": "@박동현 내 댓글"}, headers=csrf(client))).json()
    keep = (await client.post(url, json={"body": "@박동현 남는 댓글"}, headers=csrf(client))).json()
    assert len(list((await app_db.execute(select(Notification))).scalars())) == 2

    await login(client, "donghyun@zenith.co.kr")
    r = await client.delete(f"{url}/{mine['id']}", headers=csrf(client))
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    denied = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied"))
    ).scalar_one()
    assert (denied.actor_id, denied.detail["comment_id"]) == (users.lead.id, mine["id"])

    assert len((await client.get(url)).json()["items"]) == 2  # 거부됐으니 그대로

    await login(client, "sujin@zenith.co.kr")
    r = await client.delete(f"{url}/{mine['id']}", headers=csrf(client))
    assert (r.status_code, r.content) == (204, b"")
    assert [c["id"] for c in (await client.get(url)).json()["items"]] == [keep["id"]]
    left = list((await app_db.execute(select(Notification))).scalars())  # 그 댓글의 알림만 사라진다
    assert [n.payload["comment_id"] for n in left] == [keep["id"]]
    done = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.comment_deleted"))
    ).scalar_one()
    assert (done.actor_id, done.detail["preview"]) == (users.member.id, "@박동현 내 댓글")
    # 두 번째는 404 — 처음 보는 id·다른 문서 id 아래의 댓글 id 도 404
    assert (await client.delete(f"{url}/{mine['id']}", headers=csrf(client))).status_code == 404
    assert (await client.delete(f"{url}/{uuid.uuid4()}", headers=csrf(client))).status_code == 404
    other = await _doc(client, root.id, "다른 문서")
    r = await client.delete(f"/api/docs/{other['id']}/comments/{keep['id']}", headers=csrf(client))
    assert r.status_code == 404
    await client.delete(f"/api/docs/{doc['id']}", headers=csrf(client))  # 휴지통
    assert (await client.delete(f"{url}/{keep['id']}", headers=csrf(client))).status_code == 404


async def test_purge_trash_after_30_days(client: AsyncClient, users: Users, app_db) -> None:
    """04 §3 DELETE — 휴지통 30일. 기한 지난 문서만 캐스케이드로 지우고 감사 `docs.purged` 를 남긴다."""
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    old = await _doc(client, root.id, "오래된 것")
    fresh = await _doc(client, root.id, "며칠 된 것")
    live = await _doc(client, root.id, "살아 있는 것")
    await client.post(f"/api/docs/{old['id']}/comments", json={"body": "c"}, headers=csrf(client))
    for d in (old, fresh):
        assert (
            await client.delete(f"/api/docs/{d['id']}", headers=csrf(client))
        ).status_code == 204
    now = datetime.now(UTC)
    old_row = await app_db.get(Document, uuid.UUID(old["id"]))
    old_row.deleted_at = now - timedelta(days=31)
    (await app_db.get(Document, uuid.UUID(fresh["id"]))).deleted_at = now - timedelta(days=29)
    await app_db.flush()

    assert await purge_trash(app_db, now=now) == 1
    assert (await client.get(f"/api/docs/{old['id']}")).status_code == 404
    rows = (await app_db.execute(select(DocComment).where(DocComment.doc_id == old["id"]))).all()
    assert rows == []
    assert (await client.get(f"/api/docs/{fresh['id']}")).status_code == 200
    assert (await client.get(f"/api/docs/{live['id']}")).status_code == 200
    ev = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.purged"))
    ).scalar_one()
    assert (ev.actor_id, str(ev.target_id)) == (None, old["id"])
    assert await purge_trash(app_db, now=now) == 0  # 두 번 돌려도 더 지울 게 없다
    trash = (await client.get("/api/trash")).json()["items"]  # 지워진 것은 목록에서도 사라진다
    assert [d["id"] for d in trash] == [fresh["id"]]


async def test_lists_do_not_load_doc_bodies(client: AsyncClient, users: Users, app_db) -> None:
    """목록 경로(트리·휴지통·홈·검색·버전 목록)는 본문 원본·평문·스냅샷을 DB 에서 읽지 않는다.

    문서 수·버전 수에 비례해 커지는 칸이다(models.DOC_LIST_OPTS). 목록을 읽은 뒤에도 상세는 본문을 준다.
    """
    root = await _root(app_db)
    await login(client, "sujin@zenith.co.kr")
    doc = await _doc(client, root.id, "로드맵 문서")
    trashed = await _doc(client, root.id, "지울 문서")
    await client.delete(f"/api/docs/{trashed['id']}", headers=csrf(client))
    await client.post(
        f"/api/docs/{doc['id']}/versions", json={"snapshot": SNAP}, headers=csrf(client)
    )

    selected: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            selected.append(
                statement.split("FROM")[0]
            )  # 뽑는 칸만. WHERE 의 tsv·text_cache 식은 괜찮다

    event.listen(Engine, "before_cursor_execute", record)
    try:
        for path in (
            "/api/tree",
            "/api/trash",
            "/api/me/home",
            "/api/search?q=로드맵",
            f"/api/docs/{doc['id']}/versions",
        ):
            r = await client.get(path)
            assert r.status_code == 200, path
            if "search" in path:  # 토큰이 안 잡히면 문서 SELECT 가 아예 안 나가 검사가 비어 버린다
                assert [h["type"] for h in r.json()] == ["doc"]
    finally:
        event.remove(Engine, "before_cursor_execute", record)

    # 뽑는 칸으로 나온 것만 잡는다(SELECT 바로 뒤거나 콤마 뒤). 검색의 ts_rank(coalesce(documents.tsv, …))·
    # ts_headline(… text_cache …) 은 DB 안에서 계산되고 행으로 오지 않는다.
    heavy = re.compile(
        r"(?:SELECT|,)\s+documents\.(?:ydoc_snapshot|text_cache|tsv)\b|doc_versions\.snapshot"
    )
    offenders = [cols for cols in selected if heavy.search(cols)]
    assert not offenders, " | ".join(offenders)

    detail = (await client.get(f"/api/docs/{doc['id']}")).json()  # 같은 세션에서도 상세는 멀쩡하다
    assert "ydoc" in detail
    # 목록이 스냅샷 없이 읽어 둔 버전을 접어 저장해도 응답은 새 스냅샷을 싣는다(리뷰 M2)
    r = await client.post(
        f"/api/docs/{doc['id']}/versions", json={"snapshot": SNAP}, headers=csrf(client)
    )
    assert (r.status_code, r.json()["snapshot"]) == (201, SNAP)
