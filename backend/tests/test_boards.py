"""04-API §6 게시판 — FR-BRD-01~04 · TC-BRD-01(마스킹) · 02(403+감사) · 03(lead 열람·작성) · 04(알림은 열람 가능 등급만)."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent, Board, Notification, Post, PostComment

from .conftest import Users, csrf, login


async def _seed(app_db, users: Users) -> dict:
    notice = Board(name="전체공지", min_role="member")
    leads = Board(name="팀장 회의록", min_role="lead")
    execs = Board(name="경영 보고", min_role="exec")
    app_db.add_all([notice, leads, execs])
    await app_db.flush()
    now = datetime.now(UTC)
    posts = [
        Post(
            board_id=execs.id,
            title="임원 보고",
            body="비밀",
            author_id=users.exec.id,
            created_at=now,
        ),
        Post(
            board_id=leads.id,
            title="팀장 회의",
            body="팀장만",
            author_id=users.lead.id,
            created_at=now,
        ),
    ] + [
        Post(
            board_id=notice.id,
            title=f"공지 {i}",
            body=f"본문 {i}",
            author_id=users.exec.id,
            created_at=now - timedelta(minutes=5 - i),
        )
        for i in range(5)
    ]
    app_db.add_all(posts)
    await app_db.flush()
    return {"notice": notice, "leads": leads, "execs": execs, "posts": posts}


async def test_member_list_masks_and_body_is_403(client: AsyncClient, users: Users, app_db) -> None:
    """TC-BRD-01·02: member 는 목록에서 임원 글 제목이 가려지고, 본문을 직접 부르면 403 + acl.denied."""
    s = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/boards")
    assert r.status_code == 200, r.text
    assert [(b["name"], b["allowed"]) for b in r.json()["items"]] == [
        ("전체공지", True),
        ("팀장 회의록", False),
        ("경영 보고", False),
    ]
    r = await client.get(f"/api/boards/{s['execs'].id}/posts")
    item = r.json()["items"][0]
    assert item["title"] == "＿＿＿＿＿ 보고" and item["masked"] is True and item["author"] is None
    assert item["board_name"] == "경영 보고" and item["min_role"] == "exec"
    r = await client.get(f"/api/posts/{s['posts'][0].id}")
    assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
    r = await client.post(
        f"/api/boards/{s['execs'].id}/posts", json={"title": "x", "body": "y"}, headers=csrf(client)
    )
    assert r.status_code == 403
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert {d.detail["reason"] for d in denied} == {"read", "write"} and all(
        d.actor_id == users.member.id for d in denied
    )

    # 내 게시판은 제목·작성자가 그대로, 최신순, 커서 페이징
    r = await client.get(f"/api/boards/{s['notice'].id}/posts?limit=3")
    page = r.json()
    assert [p["title"] for p in page["items"]] == ["공지 4", "공지 3", "공지 2"]
    assert page["items"][0]["masked"] is False and page["items"][0]["author"]["name"] == "최재호"
    r = await client.get(f"/api/boards/{s['notice'].id}/posts?limit=3&cursor={page['next_cursor']}")
    assert [p["title"] for p in r.json()["items"]] == ["공지 1", "공지 0"] and r.json()[
        "next_cursor"
    ] is None
    r = await client.get("/api/boards/00000000-0000-0000-0000-000000000000/posts")
    assert r.status_code == 404


async def test_lead_reads_and_writes_lead_board_and_notifies(
    client: AsyncClient, users: Users, app_db
) -> None:
    """TC-BRD-03·04: lead 는 팀장 게시판을 읽고 쓴다. 새 글 알림은 lead·exec 에게만(member 제외, 글쓴이 제외)."""
    s = await _seed(app_db, users)
    await login(client, "donghyun@zenith.co.kr")
    r = await client.get(f"/api/posts/{s['posts'][1].id}")
    assert r.status_code == 200 and r.json()["body"] == "팀장만"
    r = await client.post(
        f"/api/boards/{s['leads'].id}/posts",
        json={"title": " 새 회의록 ", "body": "안건 1"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    post = r.json()
    assert (
        post["title"] == "새 회의록"
        and post["author"]["name"] == "박동현"
        and post["masked"] is False
    )
    notes = (
        (await app_db.execute(select(Notification).where(Notification.kind == "post")))
        .scalars()
        .all()
    )
    assert {n.user_id for n in notes} == {users.exec.id}  # member 는 못 보는 게시판, 글쓴이 제외
    assert (
        notes[0].payload["post_id"] == post["id"]
        and notes[0].payload["board_name"] == "팀장 회의록"
    )
    r = await client.get(f"/api/posts/{s['posts'][0].id}")  # 임원 글은 lead 도 403
    assert r.status_code == 403


async def test_edit_delete_by_author_or_exec_only(
    client: AsyncClient, users: Users, app_db
) -> None:
    """수정·삭제는 글쓴이 또는 exec. 다른 member 는 403 + 감사."""
    s = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        f"/api/boards/{s['notice'].id}/posts",
        json={"title": "내 글", "body": "본문"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    mine = r.json()["id"]
    r = await client.patch(f"/api/posts/{mine}", json={"body": "고친 본문"}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["body"] == "고친 본문" and r.json()["title"] == "내 글"
    others = str(s["posts"][2].id)  # 최재호가 쓴 전체공지
    r = await client.patch(f"/api/posts/{others}", json={"title": "훼손"}, headers=csrf(client))
    assert r.status_code == 403
    r = await client.delete(f"/api/posts/{others}", headers=csrf(client))
    assert r.status_code == 403
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert {d.detail["reason"] for d in denied} == {"edit", "delete"}
    r = await client.delete(f"/api/posts/{mine}", headers=csrf(client))
    assert r.status_code == 204
    r = await client.get(f"/api/posts/{mine}")
    assert r.status_code == 404

    await login(client, "jaeho@zenith.co.kr")  # exec 는 남의 글도
    r = await client.patch(
        f"/api/posts/{others}", json={"title": "임원이 고침"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["title"] == "임원이 고침"
    r = await client.delete(f"/api/posts/{others}", headers=csrf(client))
    assert r.status_code == 204
    r = await client.post(
        f"/api/boards/{s['notice'].id}/posts",
        json={"title": "전체 공지", "body": "모두"},
        headers=csrf(client),
    )
    assert r.status_code == 201
    notes = (
        (
            await app_db.execute(
                select(Notification).where(
                    Notification.kind == "post", Notification.payload["title"].astext == "전체 공지"
                )
            )
        )
        .scalars()
        .all()
    )
    assert {n.user_id for n in notes} == {users.member.id, users.lead.id}  # 전원(글쓴이 제외)


async def test_post_comments(client: AsyncClient, users: Users, app_db) -> None:
    """이슈 #292: 열람·작성은 글과 같은 등급(403+감사), 고치기는 쓴 사람만, 지우기는 쓴 사람·exec. 글을 지우면 같이 사라진다."""
    s = await _seed(app_db, users)
    notice = str(s["posts"][2].id)  # 전체공지 — 전원
    secret = str(s["posts"][0].id)  # 경영 보고 — exec 만
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    # 등급 밖 글은 목록·등록 모두 403 + acl.denied
    r = await client.get(f"/api/posts/{secret}/comments")
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    r = await client.post(f"/api/posts/{secret}/comments", json={"body": "x"}, headers=h)
    assert r.status_code == 403
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 2 and {e.detail["post_id"] for e in denied} == {secret}
    assert (await client.get(f"/api/posts/{uuid.uuid4()}/comments")).status_code == 404

    r = await client.post(
        f"/api/posts/{notice}/comments", json={"body": " 첫 댓글 @최재호 "}, headers=h
    )
    assert r.status_code == 201, r.text
    mine = r.json()
    assert set(mine) == {"id", "author", "body", "created_at", "edited_at"}
    assert (mine["body"], mine["author"]["name"], mine["edited_at"]) == (
        "첫 댓글 @최재호",
        "김수진",
        None,
    )
    assert (
        await client.post(f"/api/posts/{notice}/comments", json={"body": "  "}, headers=h)
    ).status_code == 422
    r = await client.post(
        f"/api/posts/{notice}/comments", json={"body": "x", "block_id": "b"}, headers=h
    )
    assert r.status_code == 422
    assert (
        list((await app_db.execute(select(Notification))).scalars()) == []
    )  # 멘션은 해석하지 않는다

    # 남이 고치면 403, 쓴 사람은 그대로면 edited_at 없음, 고치면 edited_at + 감사
    await login(client, "donghyun@zenith.co.kr")
    r = await client.patch(
        f"/api/posts/{notice}/comments/{mine['id']}", json={"body": "남이"}, headers=csrf(client)
    )
    assert r.status_code == 403
    second = (
        await client.post(
            f"/api/posts/{notice}/comments", json={"body": "둘째"}, headers=csrf(client)
        )
    ).json()
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    r = await client.patch(
        f"/api/posts/{notice}/comments/{mine['id']}", json={"body": "첫 댓글 @최재호"}, headers=h
    )
    assert r.status_code == 200 and r.json()["edited_at"] is None
    r = await client.patch(
        f"/api/posts/{notice}/comments/{mine['id']}", json={"body": "고침"}, headers=h
    )
    assert r.status_code == 200 and r.json()["body"] == "고침" and r.json()["edited_at"] is not None
    items = (await client.get(f"/api/posts/{notice}/comments")).json()["items"]
    assert [c["body"] for c in items] == ["고침", "둘째"]  # 오래된 순
    edited = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "boards.comment_edited"))
    ).scalar_one()
    assert edited.detail["before"] == "첫 댓글 @최재호"
    # 다른 글 아래의 댓글 id 는 404
    other = str(s["posts"][3].id)
    r = await client.patch(
        f"/api/posts/{other}/comments/{mine['id']}", json={"body": "x"}, headers=h
    )
    assert r.status_code == 404

    # 지우기: 남의 것은 403(감사에 comment_id), 없는 것 404, 쓴 사람은 자기 것을 지운다
    r = await client.delete(f"/api/posts/{notice}/comments/{second['id']}", headers=h)
    assert r.status_code == 403
    last = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )[-1]
    assert (last.detail["reason"], last.detail["comment_id"]) == ("comment_delete", second["id"])
    assert (
        await client.delete(f"/api/posts/{notice}/comments/{uuid.uuid4()}", headers=h)
    ).status_code == 404
    third = (
        await client.post(f"/api/posts/{notice}/comments", json={"body": "셋째"}, headers=h)
    ).json()
    assert (
        await client.delete(f"/api/posts/{notice}/comments/{third['id']}", headers=h)
    ).status_code == 204
    # 등급 밖 글의 댓글은 쓴 사람이라도(강등) 고치기·지우기 전부 403 — 등급 판정이 소유 판정보다 먼저
    await login(client, "jaeho@zenith.co.kr")
    sc = (
        await client.post(
            f"/api/posts/{secret}/comments", json={"body": "임원 댓글"}, headers=csrf(client)
        )
    ).json()
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)
    r = await client.patch(
        f"/api/posts/{secret}/comments/{sc['id']}", json={"body": "x"}, headers=h
    )
    assert r.status_code == 403
    assert (
        await client.delete(f"/api/posts/{secret}/comments/{sc['id']}", headers=h)
    ).status_code == 403
    # 임원은 남의 것도 지운다(감사에 author_id)
    await login(client, "jaeho@zenith.co.kr")
    r = await client.delete(f"/api/posts/{notice}/comments/{second['id']}", headers=csrf(client))
    assert (r.status_code, r.content) == (204, b"")
    gone = (
        await app_db.execute(
            select(AuditEvent).where(
                AuditEvent.kind == "boards.comment_deleted",
                AuditEvent.detail["comment_id"].astext == second["id"],
            )
        )
    ).scalar_one()
    assert (gone.actor_id, gone.detail["author_id"], gone.detail["preview"]) == (
        users.exec.id,
        str(users.lead.id),
        "둘째",
    )
    assert [
        c["id"] for c in (await client.get(f"/api/posts/{notice}/comments")).json()["items"]
    ] == [mine["id"]]
    # 글을 지우면 댓글도 같이 — 몇 개가 사라졌는지는 감사에
    assert (await client.delete(f"/api/posts/{notice}", headers=csrf(client))).status_code == 204
    rows = (await app_db.execute(select(PostComment).where(PostComment.post_id == notice))).all()
    assert rows == []
    deleted = (
        await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "boards.post_deleted"))
    ).scalar_one()
    assert deleted.detail["comment_count"] == 1


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _attach(client: AsyncClient, board_id, name: str, data: bytes, content_type: str):
    return await client.post(
        f"/api/boards/{board_id}/attachments",
        files={"file": (name, data, content_type)},
        headers=csrf(client),
    )


async def test_post_attachments(client: AsyncClient, users: Users, app_db, minio_bucket) -> None:
    """이슈 #299: 게시판 등급으로 올리고 받는다(밖은 403+감사). 글에 실리는 url 은 그 게시판 것만(422), [] 는 전부 뗌, null 422."""
    s = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await _attach(client, s["execs"].id, "x.png", PNG, "image/png")
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    r = await _attach(client, s["notice"].id, "회의 사진.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    att = r.json()
    assert set(att) == {"url", "name", "size", "content_type"}
    assert att["url"].startswith(f"/api/boards/{s['notice'].id}/attachments/") and att[
        "size"
    ] == len(PNG)
    assert (await _attach(client, s["notice"].id, "e.txt", b"", "text/plain")).status_code == 422
    doc = (await _attach(client, s["notice"].id, "자료.pdf", b"%PDF", "application/pdf")).json()

    got = await client.get(att["url"])
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-disposition"].startswith("inline;")
    got = await client.get(doc["url"])
    assert got.headers["content-disposition"].startswith("attachment;")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert got.headers["cache-control"] == "private, max-age=86400"
    # 임원 게시판에 올린 파일은 등급 밖에서 못 받는다 — 403 + acl.denied(reason attach)
    await login(client, "jaeho@zenith.co.kr")
    sec = (await _attach(client, s["execs"].id, "비밀.pdf", b"%PDF", "application/pdf")).json()
    await login(client, "sujin@zenith.co.kr")
    r = await client.get(sec["url"])
    assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN")
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert [e.detail["reason"] for e in denied] == ["attach", "attach"]  # 올리기 1 + 받기 1
    # 다른 게시판 경로에 같은 file_id 를 끼워도 404 — 키에 게시판 id 가 있다
    swapped = att["url"].replace(str(s["notice"].id), str(s["leads"].id))
    await login(client, "donghyun@zenith.co.kr")
    assert (await client.get(swapped)).status_code == 404
    await login(client, "sujin@zenith.co.kr")
    h = csrf(client)

    # 글에 싣기: 그 게시판의 url 만. 다른 게시판 것·이름이 다른 것은 422
    url = f"/api/boards/{s['notice'].id}/posts"
    r = await client.post(
        url, json={"title": "첨부 글", "body": "본문", "attachments": [att, doc]}, headers=h
    )
    assert r.status_code == 201, r.text
    post = r.json()
    assert [a["name"] for a in post["attachments"]] == ["회의 사진.png", "자료.pdf"]
    bad = {**att, "url": swapped}
    r = await client.post(url, json={"title": "x", "body": "y", "attachments": [bad]}, headers=h)
    assert r.status_code == 422
    r = await client.post(
        url,
        json={"title": "x", "body": "y", "attachments": [{**att, "name": "연봉.pdf"}]},
        headers=h,
    )
    assert r.status_code == 422
    r = await client.post(
        url, json={"title": "x", "body": "y", "attachments": [att] * 11}, headers=h
    )
    assert r.status_code == 422
    plain = (await client.post(url, json={"title": "없음", "body": "y"}, headers=h)).json()
    assert plain["attachments"] == []
    assert (await client.get(f"/api/posts/{post['id']}")).json()["attachments"][0]["url"] == att[
        "url"
    ]

    # 고치기: 안 보내면 그대로, [] 는 전부 뗌, null 은 422, 다른 게시판 url 은 422
    r = await client.patch(f"/api/posts/{post['id']}", json={"title": "제목만"}, headers=h)
    assert r.status_code == 200 and len(r.json()["attachments"]) == 2
    r = await client.patch(f"/api/posts/{post['id']}", json={"attachments": [bad]}, headers=h)
    assert r.status_code == 422
    tricky = {**att, "url": att["url"] + "?x", "name": att["name"] + "?x"}
    r = await client.patch(f"/api/posts/{post['id']}", json={"attachments": [tricky]}, headers=h)
    assert r.status_code == 422
    r = await client.patch(f"/api/posts/{post['id']}", json={"attachments": None}, headers=h)
    assert r.status_code == 422
    r = await client.patch(f"/api/posts/{post['id']}", json={"attachments": [doc]}, headers=h)
    assert r.status_code == 200 and [a["name"] for a in r.json()["attachments"]] == ["자료.pdf"]
    r = await client.patch(f"/api/posts/{post['id']}", json={"attachments": []}, headers=h)
    assert r.status_code == 200 and r.json()["attachments"] == []
    assert (await client.get(att["url"])).status_code == 200  # 뗀 파일은 저장소에 남는다(README 34)


async def test_review_edges(client: AsyncClient, users: Users, app_db) -> None:
    """리뷰 후속 — 강등 뒤 알림함 마스킹(HIGH), 모르는 등급 닫힘, 비활성 제외, lead 게시판 마스킹, exec 삭제 감사,
    null·빈 PATCH, 없는 게시판 POST, 잘못된 커서."""
    s = await _seed(app_db, users)
    odd = Board(name="이상한 등급", min_role="admin")
    app_db.add(odd)
    await app_db.flush()
    app_db.add(Post(board_id=odd.id, title="유령", body="x", author_id=users.exec.id))
    users.member.active = False  # 비활성은 알림 대상에서 빠진다
    await app_db.flush()

    await login(client, "jaeho@zenith.co.kr")
    r = await client.get(f"/api/boards/{odd.id}/posts")
    assert r.json()["items"][0]["masked"] is True  # 모르는 등급은 임원도 못 본다
    r = await client.post(
        f"/api/boards/{odd.id}/posts", json={"title": "a", "body": "b"}, headers=csrf(client)
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/boards/00000000-0000-0000-0000-000000000000/posts",
        json={"title": "a", "body": "b"},
        headers=csrf(client),
    )
    assert r.status_code == 404
    r = await client.post(
        f"/api/boards/{s['notice'].id}/posts",
        json={"title": "전원 공지", "body": "b"},
        headers=csrf(client),
    )
    assert r.status_code == 201
    notes = (
        (
            await app_db.execute(
                select(Notification).where(Notification.payload["title"].astext == "전원 공지")
            )
        )
        .scalars()
        .all()
    )
    assert {n.user_id for n in notes} == {users.lead.id}  # 비활성 member 제외, 글쓴이 제외
    lead_post = str(s["posts"][1].id)
    r = await client.patch(f"/api/posts/{lead_post}", json={"title": None}, headers=csrf(client))
    assert r.status_code == 422
    r = await client.patch(f"/api/posts/{lead_post}", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["title"] == "팀장 회의"
    r = await client.delete(
        f"/api/posts/{lead_post}", headers=csrf(client)
    )  # exec 가 남의 lead 글 삭제
    assert r.status_code == 204
    deleted = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "boards.post_deleted")))
        .scalars()
        .all()
    )
    assert (
        len(deleted) == 1
        and deleted[0].detail["title"] == "팀장 회의"
        and deleted[0].actor_id == users.exec.id
    )
    for bad in (
        "zzz",
        "MjAyNi0wMS0wMVQwMDowMDowMHwwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDA=",
    ):  # naive datetime
        r = await client.get(f"/api/boards/{s['notice'].id}/posts?cursor={bad}")
        assert r.status_code == 422, bad

    # lead 가 팀장 게시판에 글 → exec 알림. 그 뒤 exec 를 member 로 강등하면 알림함에서 제목이 가려진다 (HIGH)
    await login(client, "donghyun@zenith.co.kr")
    r = await client.get(f"/api/boards/{s['execs'].id}/posts")
    assert r.json()["items"][0]["masked"] is True  # lead 도 임원 게시판은 마스킹
    r = await client.post(
        f"/api/boards/{s['leads'].id}/posts",
        json={"title": "팀장 비밀 안건", "body": "b"},
        headers=csrf(client),
    )
    assert r.status_code == 201
    await login(client, "jaeho@zenith.co.kr")
    items = (await client.get("/api/me/notifications")).json()["items"]
    assert any(n["payload"].get("title") == "팀장 비밀 안건" for n in items)
    users.exec.role = "member"
    await app_db.flush()
    items = (await client.get("/api/me/notifications")).json()["items"]
    hit = next(n for n in items if n["payload"].get("board_name") == "팀장 회의록")
    assert hit["payload"]["title"] == "＿＿＿＿＿ 보고" and hit["payload"]["masked"] is True
    assert hit["payload"]["from"] is None  # 작성자도 가린다 — 목록의 author=None 과 같은 기준
    assert all(n["payload"].get("title") != "팀장 비밀 안건" for n in items)

    # 등급이 돌아오면 다시 보이고, 글이 지워지면 등급과 무관하게 닫힌다(min_roles 에 없으면 "?"→99 로 fail-closed)
    users.exec.role = "exec"
    await app_db.flush()
    items = (await client.get("/api/me/notifications")).json()["items"]
    secret = next(n for n in items if n["payload"].get("title") == "팀장 비밀 안건")
    await login(client, "donghyun@zenith.co.kr")  # 글쓴이가 지운다
    r = await client.delete(f"/api/posts/{secret['payload']['post_id']}", headers=csrf(client))
    assert r.status_code == 204, r.text
    await login(client, "jaeho@zenith.co.kr")
    items = (await client.get("/api/me/notifications")).json()["items"]
    gone = next(n for n in items if n["id"] == secret["id"])
    assert gone["payload"]["masked"] is True and gone["payload"]["from"] is None

    # 마스킹은 응답만 바꾼다 — 세션에 붙은 알림 행은 dirty 가 되지 않는다(commit 이 끼면 원본이 지워진다)
    rows = (await app_db.execute(select(Notification))).scalars().all()
    row = next(n for n in rows if (n.payload or {}).get("post_id") == secret["payload"]["post_id"])
    assert row.payload["title"] == "팀장 비밀 안건" and row.payload["from"]["name"] == "박동현"
