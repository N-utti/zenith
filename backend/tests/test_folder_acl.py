"""README 57 — 폴더 등급 + 사람 지정. 트리·상세·검색·AI·yjs·파일·자료실·홈이 전부 서버에서 걸러지고, 설정은 임원만."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx_ws import WebSocketDisconnect, aconnect_ws
from sqlalchemy import select

from app.models import AuditEvent, Document, Folder, FolderMember, Workspace

from .conftest import Users, csrf, login, share_session
from .test_approvals import _as
from .test_docs import SNAP


@pytest.fixture
async def c(make_client, users: Users):
    async with (
        _as(make_client, "sujin@zenith.co.kr") as member,
        _as(make_client, "donghyun@zenith.co.kr") as lead,
        _as(make_client, "jaeho@zenith.co.kr") as exec_,
    ):
        yield SimpleNamespace(member=member, lead=lead, exec=exec_)


async def _seed(app_db, users: Users) -> SimpleNamespace:
    """회사 위키(전원) · 팀장방(lead) ⊃ 팀장 하위(member 라도 조상이 막는다) · 임원방(exec, 김수진 사람 지정)."""
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    wiki = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    leads = Folder(ws_id=ws.id, parent_id=None, title="팀장방", min_role="lead")
    execs = Folder(ws_id=ws.id, parent_id=None, title="임원방", min_role="exec")
    app_db.add_all([wiki, leads, execs])
    await app_db.flush()
    sub = Folder(ws_id=ws.id, parent_id=leads.id, title="팀장 하위")
    app_db.add(sub)
    app_db.add(FolderMember(folder_id=execs.id, user_id=users.member.id))
    await app_db.flush()
    docs = {}
    for key, folder, text in (
        ("wiki", wiki, "연차 이월 안내"),
        ("leads", leads, "연차 이월 팀장 지침"),
        ("sub", sub, "연차 이월 하위 메모"),
        ("execs", execs, "연차 이월 임원 보고"),
    ):
        d = Document(folder_id=folder.id, title=text, text_cache=text, updated_by=users.lead.id)
        app_db.add(d)
        docs[key] = d
    await app_db.flush()
    from sqlalchemy import func, update

    for d in docs.values():
        await app_db.execute(
            update(Document)
            .where(Document.id == d.id)
            .values(tsv=func.to_tsvector("simple", d.title))
        )
    return SimpleNamespace(wiki=wiki, leads=leads, sub=sub, execs=execs, docs=docs)


async def test_tree_and_detail_follow_folder_acl(c, users: Users, app_db) -> None:
    s = await _seed(app_db, users)

    # 트리 — 사원: 위키 + 임원방(사람 지정), 팀장: 위키·팀장방·하위, 임원: 전부
    async def titles(client):
        t = (await client.get("/api/tree")).json()
        return {f["title"] for f in t["folders"]}, {d["title"] for d in t["docs"]}

    folders, docs = await titles(c.member)
    assert folders == {"회사 위키", "임원방"} and docs == {"연차 이월 안내", "연차 이월 임원 보고"}
    folders, docs = await titles(c.lead)
    assert folders == {"회사 위키", "팀장방", "팀장 하위"} and "연차 이월 임원 보고" not in docs
    folders, _ = await titles(c.exec)
    assert folders == {"회사 위키", "팀장방", "팀장 하위", "임원방"}
    t = (await c.exec.get("/api/tree")).json()
    execs = next(f for f in t["folders"] if f["title"] == "임원방")
    assert execs["min_role"] == "exec" and execs["allowed_users"] == [str(users.member.id)]
    # 상세·버전·댓글 — 못 보는 폴더는 403 + acl.denied, 보는 사람은 200
    sub_id = str(s.docs["sub"].id)
    for path in (
        f"/api/docs/{sub_id}",
        f"/api/docs/{sub_id}/versions",
        f"/api/docs/{sub_id}/comments",
    ):
        r = await c.member.get(path)
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN", path
        assert (await c.lead.get(path)).status_code == 200, path
    denied = (
        (
            await app_db.execute(
                select(AuditEvent).where(
                    AuditEvent.kind == "acl.denied", AuditEvent.actor_id == users.member.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert denied and all(e.detail["path"] == "docs" for e in denied)
    # 사원은 사람 지정된 임원방 문서를 본다
    assert (await c.member.get(f"/api/docs/{s.docs['execs'].id}")).status_code == 200
    # 수정·휴지통·되돌리기도 막힌다
    r = await c.member.patch(f"/api/docs/{sub_id}", json={"title": "x"}, headers=csrf(c.member))
    assert r.status_code == 403
    assert (await c.member.delete(f"/api/docs/{sub_id}", headers=csrf(c.member))).status_code == 403
    # 못 보는 폴더에 문서 만들기·이동 — 「없는 폴더」 422(존재를 새게 하지 않는다)
    r = await c.member.post(
        "/api/docs", json={"folder_id": str(s.leads.id), "title": "몰래"}, headers=csrf(c.member)
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 폴더입니다."
    r = await c.member.patch(
        f"/api/docs/{s.docs['wiki'].id}",
        json={"folder_id": str(s.leads.id)},
        headers=csrf(c.member),
    )
    assert r.status_code == 422
    assert (
        await c.member.patch(
            f"/api/folders/{s.leads.id}", json={"title": "x"}, headers=csrf(c.member)
        )
    ).status_code == 404
    assert (
        await c.member.delete(f"/api/folders/{s.sub.id}", headers=csrf(c.member))
    ).status_code == 404
    # 쓰기 경로 전부 403 — 버전 만들기·댓글·되돌리기·버전 복원
    for method, path, body in (
        ("post", f"/api/docs/{sub_id}/versions", {"snapshot": SNAP, "note": "x"}),
        ("post", f"/api/docs/{sub_id}/comments", {"body": "x"}),
        ("post", f"/api/docs/{sub_id}/untrash", None),
        (
            "post",
            f"/api/docs/{sub_id}/restore",
            {"version_id": "00000000-0000-0000-0000-000000000000"},
        ),
    ):
        r = await getattr(c.member, method)(path, json=body, headers=csrf(c.member))
        assert r.status_code == 403, (path, r.status_code, r.text)
    # 이동 = 등급 변경 — 팀장이 등급 문서를 위키로 꺼내거나 위키 문서를 팀장방에 넣는 것은 403, 임원은 된다
    r = await c.lead.patch(
        f"/api/docs/{sub_id}", json={"folder_id": str(s.wiki.id)}, headers=csrf(c.lead)
    )
    assert r.status_code == 403
    r = await c.lead.patch(
        f"/api/docs/{s.docs['wiki'].id}", json={"folder_id": str(s.leads.id)}, headers=csrf(c.lead)
    )
    assert r.status_code == 403
    r = await c.lead.patch(
        f"/api/folders/{s.sub.id}", json={"parent_id": None}, headers=csrf(c.lead)
    )
    assert r.status_code == 403
    r = await c.exec.patch(
        f"/api/docs/{sub_id}", json={"folder_id": str(s.wiki.id)}, headers=csrf(c.exec)
    )
    assert r.status_code == 200
    assert (await c.member.get(f"/api/docs/{sub_id}")).status_code == 200  # 꺼내졌다
    # 댓글 멘션 — 못 보는 사람에겐 알림이 안 간다
    r = await c.lead.post(
        f"/api/docs/{s.docs['leads'].id}/comments",
        json={"body": "@김수진 확인"},
        headers=csrf(c.lead),
    )
    assert r.status_code == 201, r.text
    from app.models import Notification

    notes = (
        (await app_db.execute(select(Notification).where(Notification.user_id == users.member.id)))
        .scalars()
        .all()
    )
    assert notes == []


async def test_search_home_archive_and_ai_follow_folder_acl(
    app: FastAPI, c, users: Users, app_db, monkeypatch
) -> None:
    s = await _seed(app_db, users)
    # 검색 — 사원은 팀장방·하위 문서가 안 나온다
    hits = (await c.member.get("/api/search", params={"q": "이월", "types": "doc"})).json()
    assert {h["title"] for h in hits} == {"연차 이월 안내", "연차 이월 임원 보고"}
    hits = (await c.lead.get("/api/search", params={"q": "이월", "types": "doc"})).json()
    assert {h["title"] for h in hits} == {
        "연차 이월 안내",
        "연차 이월 팀장 지침",
        "연차 이월 하위 메모",
    }
    # 홈 이어서 작업 — 전사 최근도 걸러진다
    home = (await c.member.get("/api/me/home")).json()
    assert {d["title"] for d in home["recent_docs"]} <= {"연차 이월 안내", "연차 이월 임원 보고"}
    # AI 참고 문서·팩트체커·범위 폴더 — 못 보는 문서/폴더는 422
    r = await c.member.post(
        "/api/ai/chat",
        json={"message": "요약", "docs": [str(s.docs["sub"].id)]},
        headers=csrf(c.member),
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 문서입니다."
    r = await c.member.post(
        "/api/ai/check", json={"doc_id": str(s.docs["sub"].id)}, headers=csrf(c.member)
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 문서입니다."
    r = await c.member.post(
        "/api/ai/chat", json={"message": "x", "scope": str(s.leads.id)}, headers=csrf(c.member)
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 폴더입니다."


async def test_yjs_rejects_invisible_doc(app: FastAPI, users: Users, app_db, monkeypatch) -> None:
    from app.realtime import yjs as mod

    from .test_yjs import expect_close, ws_client

    share_session(app, app_db, monkeypatch, mod)
    s = await _seed(app_db, users)
    async with ws_client(app) as client:
        await login(client, "sujin@zenith.co.kr")
        async with aconnect_ws(f"https://test/api/yjs/{s.docs['sub'].id}", client) as ws:
            await expect_close(ws, 4403)
    async with ws_client(app) as client:
        await login(client, "donghyun@zenith.co.kr")
        async with aconnect_ws(f"https://test/api/yjs/{s.docs['sub'].id}", client) as ws:
            await ws.send_bytes(b"\x00\x00")  # 연결이 열려 있다(거부되지 않았다)


@pytest.mark.usefixtures("minio_bucket")
async def test_doc_files_and_archive_follow_folder_acl(c, users: Users, app_db) -> None:
    s = await _seed(app_db, users)
    r = await c.lead.post(
        "/api/files",
        files={"file": ("메모.txt", b"hello", "text/plain")},
        data={"doc_id": str(s.docs["sub"].id)},
        headers=csrf(c.lead),
    )
    assert r.status_code == 201, r.text
    file_id = r.json()["id"]
    assert (await c.lead.get(f"/api/files/{file_id}")).status_code == 200
    # 못 보는 문서에 파일 붙이기 — 「없는 문서」 422(존재를 새게 하지 않는다)
    r = await c.member.post(
        "/api/files",
        files={"file": ("x.txt", b"x", "text/plain")},
        data={"doc_id": str(s.docs["sub"].id)},
        headers=csrf(c.member),
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 문서입니다."
    r = await c.member.get(f"/api/files/{file_id}")
    assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
    names = {f["name"] for f in (await c.member.get("/api/archive")).json()["items"]}
    assert "메모.txt" not in names
    names = {f["name"] for f in (await c.lead.get("/api/archive")).json()["items"]}
    assert "메모.txt" in names


async def test_only_exec_sets_folder_acl(c, users: Users, app_db) -> None:
    s = await _seed(app_db, users)
    # 사원·팀장은 등급·사람 지정을 못 바꾼다(403), 이름은 바꿀 수 있다
    r = await c.lead.patch(
        f"/api/folders/{s.leads.id}", json={"min_role": "member"}, headers=csrf(c.lead)
    )
    assert r.status_code == 403
    r = await c.lead.patch(
        f"/api/folders/{s.leads.id}", json={"title": "팀장 방"}, headers=csrf(c.lead)
    )
    assert r.status_code == 200 and r.json()["min_role"] == "lead"
    r = await c.member.post(
        "/api/folders", json={"title": "비밀", "min_role": "exec"}, headers=csrf(c.member)
    )
    assert r.status_code == 403
    # 임원은 바꾼다 — 사람 지정은 전체 교체, 없는 사용자는 422
    r = await c.exec.patch(
        f"/api/folders/{s.leads.id}",
        json={"allowed_users": [str(users.member.id)]},
        headers=csrf(c.exec),
    )
    assert r.status_code == 200 and r.json()["allowed_users"] == [str(users.member.id)]
    assert (
        await c.member.get(f"/api/docs/{s.docs['sub'].id}")
    ).status_code == 200  # 하위까지 열린다
    r = await c.exec.patch(
        f"/api/folders/{s.leads.id}", json={"allowed_users": []}, headers=csrf(c.exec)
    )
    assert r.status_code == 200 and r.json()["allowed_users"] == []
    r = await c.exec.patch(
        f"/api/folders/{s.leads.id}", json={"allowed_users": None}, headers=csrf(c.exec)
    )
    assert r.status_code == 422
    assert (await c.member.get(f"/api/docs/{s.docs['sub'].id}")).status_code == 403
    r = await c.exec.patch(
        f"/api/folders/{s.leads.id}",
        json={"allowed_users": ["00000000-0000-0000-0000-000000000000"]},
        headers=csrf(c.exec),
    )
    assert r.status_code == 422
    r = await c.exec.post(
        "/api/folders",
        json={"title": "경영", "min_role": "exec", "allowed_users": [str(users.lead.id)]},
        headers=csrf(c.exec),
    )
    assert r.status_code == 201 and r.json()["min_role"] == "exec"
    assert r.json()["allowed_users"] == [str(users.lead.id)]
    new_id = r.json()["id"]
    assert "경영" in {f["title"] for f in (await c.lead.get("/api/tree")).json()["folders"]}
    assert "경영" not in {f["title"] for f in (await c.member.get("/api/tree")).json()["folders"]}
    r = await c.exec.patch(f"/api/folders/{new_id}", json={"min_role": "x"}, headers=csrf(c.exec))
    assert r.status_code == 422


async def test_private_folder_is_owner_only(c, users: Users, app_db) -> None:
    """README 72 — 개인 폴더는 주인만 본다(임원도 못 본다). 누구나 만들고, 문서만 경계를 넘나든다(감사 기록)."""
    s = await _seed(app_db, users)
    r = await c.member.post(
        "/api/folders", json={"title": "내 것", "private": True}, headers=csrf(c.member)
    )
    assert r.status_code == 201, r.text
    mine = r.json()
    assert mine["owner_id"] == str(users.member.id) and mine["parent_id"] is None
    # 최상위에만, 등급과 같이는 안 된다(임원이어도 422). 볼 사람은 같이 고를 수 있다(README 74, 아래 테스트)
    for body in (
        {"title": "x", "private": True, "parent_id": str(s.wiki.id)},
        {"title": "x", "private": True, "min_role": "exec"},
    ):
        assert (
            await c.exec.post("/api/folders", json=body, headers=csrf(c.exec))
        ).status_code == 422, body
    # 하위 폴더·문서는 그냥 만들면 따라간다
    r = await c.member.post(
        "/api/folders", json={"title": "내 하위", "parent_id": mine["id"]}, headers=csrf(c.member)
    )
    assert r.status_code == 201 and r.json()["owner_id"] is None
    sub_id = r.json()["id"]
    r = await c.member.post(
        "/api/docs", json={"folder_id": sub_id, "title": "내 메모"}, headers=csrf(c.member)
    )
    assert r.status_code == 201, r.text
    memo = r.json()["id"]

    async def titles(client):
        t = (await client.get("/api/tree")).json()
        return {f["title"] for f in t["folders"]}, {d["title"] for d in t["docs"]}

    folders, docs = await titles(c.member)
    assert {"내 것", "내 하위"} <= folders and "내 메모" in docs
    # 임원·팀장 — 트리에 없고, 문서 403, 폴더는 「없는 폴더」, 그 안에 만들기도 못 한다
    for other in (c.exec, c.lead):
        folders, docs = await titles(other)
        assert not {"내 것", "내 하위"} & folders and "내 메모" not in docs
        assert (await other.get(f"/api/docs/{memo}")).status_code == 403
        for fid in (mine["id"], sub_id):
            r = await other.patch(
                f"/api/folders/{fid}", json={"title": "뺏기"}, headers=csrf(other)
            )
            assert r.status_code == 404
            assert (
                await other.delete(f"/api/folders/{fid}", headers=csrf(other))
            ).status_code == 404
            r = await other.post(
                "/api/docs", json={"folder_id": fid, "title": "끼어들기"}, headers=csrf(other)
            )
            assert r.status_code == 422
    # 임원이 사람 지정으로 뚫을 수도 없다 — 폴더가 안 보여 404, 주인도 등급·사람 지정은 못 건다
    r = await c.member.patch(
        f"/api/folders/{mine['id']}", json={"min_role": "member"}, headers=csrf(c.member)
    )
    assert r.status_code == 403  # 임원 검사가 먼저
    r = await c.exec.post(
        "/api/folders", json={"title": "임원 것", "private": True}, headers=csrf(c.exec)
    )
    exec_own = r.json()["id"]
    r = await c.exec.patch(
        f"/api/folders/{exec_own}",
        json={"allowed_users": [str(users.lead.id)]},
        headers=csrf(c.exec),
    )
    # 내 개인 폴더의 볼 사람은 내가 고른다(README 74) — 고르면 그 사람에게 보이고, 비우면 다시 나만 본다
    assert r.status_code == 200
    assert "임원 것" in (await titles(c.lead))[0]
    r = await c.exec.patch(
        f"/api/folders/{exec_own}", json={"allowed_users": []}, headers=csrf(c.exec)
    )
    assert r.status_code == 200
    assert "임원 것" not in (await titles(c.lead))[0]
    # 문서는 주인이 넣고 뺀다 — 넣으면 임원도 못 보고 감사에 제목이 남는다
    wiki_doc = str(s.docs["wiki"].id)
    r = await c.member.patch(
        f"/api/docs/{wiki_doc}", json={"folder_id": mine["id"]}, headers=csrf(c.member)
    )
    assert r.status_code == 200, r.text
    assert (await c.exec.get(f"/api/docs/{wiki_doc}")).status_code == 403
    moved = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.private_move")))
        .scalars()
        .all()
    )
    assert len(moved) == 1 and moved[0].detail["into"] is True
    assert moved[0].detail["title"] == "연차 이월 안내" and moved[0].actor_id == users.member.id
    r = await c.member.patch(
        f"/api/docs/{wiki_doc}", json={"folder_id": str(s.wiki.id)}, headers=csrf(c.member)
    )
    assert r.status_code == 200
    assert (await c.exec.get(f"/api/docs/{wiki_doc}")).status_code == 200
    # 남의 개인 폴더로는 못 넣는다(대상이 안 보여 「없는 폴더」)
    r = await c.lead.patch(
        f"/api/docs/{wiki_doc}", json={"folder_id": mine["id"]}, headers=csrf(c.lead)
    )
    assert r.status_code == 422
    # 폴더는 경계를 못 넘는다 — 하위를 밖으로, 공용 폴더를 안으로, 개인 폴더를 다른 폴더 아래로
    for fid, parent in ((sub_id, None), (str(s.wiki.id), mine["id"]), (mine["id"], str(s.wiki.id))):
        r = await c.member.patch(
            f"/api/folders/{fid}", json={"parent_id": parent}, headers=csrf(c.member)
        )
        assert r.status_code == 422, (fid, parent)
    # 안에서의 이동·이름 바꾸기는 된다
    r = await c.member.post(
        "/api/folders", json={"title": "내 하위 2", "parent_id": mine["id"]}, headers=csrf(c.member)
    )
    r = await c.member.patch(
        f"/api/folders/{r.json()['id']}", json={"parent_id": sub_id}, headers=csrf(c.member)
    )
    assert r.status_code == 200
    r = await c.member.patch(
        f"/api/folders/{mine['id']}",
        json={"title": "내 서랍", "parent_id": None},
        headers=csrf(c.member),
    )
    assert r.status_code == 200 and r.json()["owner_id"] == str(users.member.id)


async def test_private_folder_hides_from_exec_everywhere(
    app: FastAPI, c, users: Users, app_db, monkeypatch
) -> None:
    """README 72 — 임원에게도 검색·홈·버전·댓글·AI·휴지통·실시간 편집이 전부 막힌다. 넣는 순간 열려 있던 편집도 끊긴다."""
    from sqlalchemy import func, update

    from app.realtime import yjs as mod

    from .test_yjs import expect_close, ws_client

    share_session(app, app_db, monkeypatch, mod)
    s = await _seed(app_db, users)
    mine = Folder(ws_id=s.wiki.ws_id, parent_id=None, title="내 것", owner_id=users.member.id)
    app_db.add(mine)
    await app_db.flush()
    secret = Document(
        folder_id=mine.id,
        title="연차 이월 비밀",
        text_cache="연차 이월 비밀",
        updated_by=users.member.id,
    )
    app_db.add(secret)
    await app_db.flush()
    await app_db.execute(
        update(Document)
        .where(Document.id == secret.id)
        .values(tsv=func.to_tsvector("simple", secret.title))
    )
    sid = str(secret.id)
    hits = (await c.exec.get("/api/search", params={"q": "이월", "types": "doc"})).json()
    assert "연차 이월 비밀" not in {h["title"] for h in hits}
    # 주인에게는 보통 문서다 — 검색(⌘K 와 AI 검색 도구가 같은 find_hits)·AI 참고 문서·질문 범위에 그대로 쓰인다
    hits = (await c.member.get("/api/search", params={"q": "이월", "types": "doc"})).json()
    assert "연차 이월 비밀" in {h["title"] for h in hits}
    from app.routers import ai as ai_mod

    assert (await ai_mod._scope_folder(app_db, users.member, str(mine.id))).id == mine.id
    home = (await c.exec.get("/api/me/home")).json()
    assert "연차 이월 비밀" not in {d["title"] for d in home["recent_docs"]}
    for path in (f"/api/docs/{sid}", f"/api/docs/{sid}/versions", f"/api/docs/{sid}/comments"):
        assert (await c.exec.get(path)).status_code == 403, path
        assert (await c.member.get(path)).status_code == 200, path
    r = await c.exec.post(
        "/api/ai/chat", json={"message": "요약", "docs": [sid]}, headers=csrf(c.exec)
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 문서입니다."
    r = await c.exec.post(
        "/api/ai/chat", json={"message": "x", "scope": str(mine.id)}, headers=csrf(c.exec)
    )
    assert r.status_code == 422 and r.json()["detail"] == "없는 폴더입니다."
    # 휴지통 — 주인만 보고 주인만 되돌린다
    assert (await c.member.delete(f"/api/docs/{sid}", headers=csrf(c.member))).status_code == 204
    assert sid not in {d["id"] for d in (await c.exec.get("/api/trash")).json()["items"]}
    assert sid in {d["id"] for d in (await c.member.get("/api/trash")).json()["items"]}
    # 실시간 — 임원이 공용 문서를 열어 둔 채 사원이 개인 폴더로 가져가면 바로 4403, 다시 붙어도 4403
    wiki_doc = str(s.docs["wiki"].id)
    # 공용일 때 임원을 멘션해 둔다 — 옮긴 뒤에는 알림의 제목·미리보기가 가려져야 한다
    r = await c.member.post(
        f"/api/docs/{wiki_doc}/comments", json={"body": "@최재호 봐 주세요"}, headers=csrf(c.member)
    )
    assert r.status_code == 201
    comment_id = r.json()["id"]
    async with ws_client(app) as client:
        await login(client, "jaeho@zenith.co.kr")
        async with aconnect_ws(f"https://test/api/yjs/{wiki_doc}", client) as ws:
            await asyncio.wait_for(ws.receive_bytes(), 3.0)  # 열렸다 — 서버의 첫 동기화 프레임
            r = await c.member.patch(
                f"/api/docs/{wiki_doc}", json={"folder_id": str(mine.id)}, headers=csrf(c.member)
            )
            assert r.status_code == 200, r.text
            with pytest.raises(
                WebSocketDisconnect
            ) as closed:  # 먼저 와 있던 동기화 프레임을 지나서
                for _ in range(10):
                    await asyncio.wait_for(ws.receive_bytes(), 3.0)
            assert closed.value.code == 4403
        async with aconnect_ws(f"https://test/api/yjs/{wiki_doc}", client) as ws:
            await expect_close(ws, 4403)
    # 옮긴 뒤 고친 댓글 — 임원의 알림함·홈에는 가려져 나오고, 감사에 원문이 안 남는다
    r = await c.member.patch(
        f"/api/docs/{wiki_doc}/comments/{comment_id}",
        json={"body": "@최재호 옮긴 뒤에 쓴 비밀"},
        headers=csrf(c.member),
    )
    assert r.status_code == 200, r.text
    for items in (
        (await c.exec.get("/api/me/notifications")).json()["items"],
        (await c.exec.get("/api/me/home")).json()["mentions"],
    ):
        note = next(n for n in items if n["payload"].get("doc_id") == wiki_doc)
        assert note["payload"]["masked"] is True and "비밀" not in str(note["payload"])
        assert "연차 이월 안내" not in str(note["payload"])
    edited = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.comment_edited")))
        .scalars()
        .all()
    )
    assert edited and all("before" not in e.detail for e in edited)
    # 개인 문서는 주인이 영구 삭제한다(임원은 못 보니 못 지운다) — 감사에 제목이 없다
    assert (await c.exec.delete(f"/api/docs/{sid}?hard=1", headers=csrf(c.exec))).status_code == 403
    assert (
        await c.member.delete(f"/api/docs/{sid}?hard=1", headers=csrf(c.member))
    ).status_code == 204
    gone = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.hard_deleted")))
        .scalars()
        .all()
    )
    assert [e.detail["title"] for e in gone] == [None]
    # 꺼낼 때의 감사에는 제목이 없다(개인 폴더 안에서 붙인 제목일 수 있다)
    r = await c.member.patch(
        f"/api/docs/{wiki_doc}", json={"folder_id": str(s.wiki.id)}, headers=csrf(c.member)
    )
    assert r.status_code == 200
    moves = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "docs.private_move")))
        .scalars()
        .all()
    )
    assert sorted(("title" in m.detail, m.detail["into"]) for m in moves) == [
        (False, False),
        (True, True),
    ]


async def test_private_folder_shares_with_chosen_people(c, users: Users, app_db) -> None:
    """README 74 — 개인 폴더라도 주인이 고른 사람은 본다. 폴더 자체·경계를 넘는 이동·영구 삭제는 주인만."""
    s = await _seed(app_db, users)
    hm, hl, he = csrf(c.member), csrf(c.lead), csrf(c.exec)
    # 만들 때 볼 사람을 같이 고른다 — 임원이 아니어도 된다(내 폴더다). 등급은 여전히 못 건다
    r = await c.member.post(
        "/api/folders",
        json={"title": "둘이 보는 것", "private": True, "allowed_users": [str(users.lead.id)]},
        headers=hm,
    )
    assert r.status_code == 201, r.text
    mine = r.json()
    assert mine["owner_id"] == str(users.member.id)
    assert mine["allowed_users"] == [str(users.lead.id)]
    sub_id = (
        await c.member.post(
            "/api/folders", json={"title": "하위", "parent_id": mine["id"]}, headers=hm
        )
    ).json()["id"]
    memo = (
        await c.member.post("/api/docs", json={"folder_id": sub_id, "title": "공유 메모"}, headers=hm)
    ).json()["id"]

    async def sees(client) -> bool:
        t = (await client.get("/api/tree")).json()
        return "둘이 보는 것" in {f["title"] for f in t["folders"]} and "공유 메모" in {
            d["title"] for d in t["docs"]
        }

    # 고른 사람은 하위 폴더·문서까지 보고, 임원은 지정받지 않았으니 못 본다
    assert await sees(c.member) and await sees(c.lead) and not await sees(c.exec)
    assert (await c.lead.get(f"/api/docs/{memo}")).status_code == 200
    assert (await c.exec.get(f"/api/docs/{memo}")).status_code == 403
    # 고른 사람은 안에서 보고 고치고 만든다
    r = await c.lead.patch(f"/api/docs/{memo}", json={"title": "공유 메모 2"}, headers=hl)
    assert r.status_code == 200
    r = await c.lead.post("/api/docs", json={"folder_id": mine["id"], "title": "팀장 메모"}, headers=hl)
    assert r.status_code == 201
    theirs = r.json()["id"]
    # 그러나 폴더 자체(이름·볼 사람·삭제)는 주인만
    for body in ({"title": "이름 바꿈"}, {"allowed_users": [str(users.exec.id)]}):
        r = await c.lead.patch(f"/api/folders/{mine['id']}", json=body, headers=hl)
        assert (r.status_code, r.json()["code"]) == (403, "FORBIDDEN"), body
    assert (await c.lead.delete(f"/api/folders/{mine['id']}", headers=hl)).status_code == 403
    # 경계를 넘는 이동도 주인만 — 꺼내면 공개되고 넣으면 숨는다
    r = await c.lead.patch(f"/api/docs/{memo}", json={"folder_id": str(s.wiki.id)}, headers=hl)
    assert r.status_code == 403
    pub = (
        await c.lead.post("/api/docs", json={"folder_id": str(s.wiki.id), "title": "공용"}, headers=hl)
    ).json()["id"]
    r = await c.lead.patch(f"/api/docs/{pub}", json={"folder_id": mine["id"]}, headers=hl)
    assert r.status_code == 403
    # 안에서 옮기는 것은 된다
    r = await c.lead.patch(f"/api/docs/{theirs}", json={"folder_id": sub_id}, headers=hl)
    assert r.status_code == 200
    # 영구 삭제도 주인만(휴지통까지는 고른 사람도 된다)
    assert (await c.lead.delete(f"/api/docs/{theirs}", headers=hl)).status_code == 204
    assert (await c.lead.delete(f"/api/docs/{theirs}?hard=1", headers=hl)).status_code == 403
    assert (await c.member.delete(f"/api/docs/{theirs}?hard=1", headers=hm)).status_code == 204
    # 하위 폴더에는 따로 사람을 못 건다(개인 폴더 자신에만)
    r = await c.member.patch(
        f"/api/folders/{sub_id}", json={"allowed_users": [str(users.exec.id)]}, headers=hm
    )
    assert r.status_code == 403  # 사원은 사람 지정 자체를 못 한다(임원 검사가 먼저)
    # 주인이 볼 사람을 바꾼다 — 빼면 바로 못 보고, 넣으면 임원도 본다
    r = await c.member.patch(
        f"/api/folders/{mine['id']}", json={"allowed_users": [str(users.exec.id)]}, headers=hm
    )
    assert r.status_code == 200 and r.json()["allowed_users"] == [str(users.exec.id)]
    assert not await sees(c.lead) and (await c.lead.get(f"/api/docs/{memo}")).status_code == 403
    assert (await c.exec.get(f"/api/docs/{memo}")).status_code == 200
    # 지정받은 임원도 남의 개인 폴더 자체는 못 고친다
    r = await c.exec.patch(f"/api/folders/{mine['id']}", json={"allowed_users": []}, headers=he)
    assert r.status_code == 403
    r = await c.member.patch(f"/api/folders/{mine['id']}", json={"allowed_users": []}, headers=hm)
    assert r.status_code == 200 and not await sees(c.exec)
    # 등급은 여전히 못 건다
    r = await c.member.patch(f"/api/folders/{mine['id']}", json={"min_role": "lead"}, headers=hm)
    assert r.status_code == 403


async def test_private_folder_boundaries_between_roots(c, users: Users, app_db) -> None:
    """README 74 리뷰 — 개인 폴더끼리도 경계다. 볼 사람으로 지정받은 사람이 하위 폴더·문서를 다른 개인 폴더로 가져가거나
    옮겨서 주인이 고르지 않은 사람에게 보여 주지 못한다. 개인 폴더의 문서 잠금은 주인만."""
    await _seed(app_db, users)
    hm, hl, he = csrf(c.member), csrf(c.lead), csrf(c.exec)

    async def folder(client, headers, **body) -> str:
        r = await client.post("/api/folders", json=body, headers=headers)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    async def doc(client, headers, folder_id, title) -> str:
        r = await client.post(
            "/api/docs", json={"folder_id": folder_id, "title": title}, headers=headers
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    # 사원의 개인 폴더 둘 — 하나는 팀장·임원이, 하나는 팀장만 본다
    wide = await folder(
        c.member, hm, title="넓게", private=True,
        allowed_users=[str(users.lead.id), str(users.exec.id)],
    )
    narrow = await folder(
        c.member, hm, title="좁게", private=True, allowed_users=[str(users.lead.id)]
    )
    sub = await folder(c.member, hm, title="하위", parent_id=narrow)
    secret = await doc(c.member, hm, sub, "비밀")
    theirs = await folder(c.lead, hl, title="팀장 것", private=True)
    theirs_sub = await folder(c.lead, hl, title="팀장 하위", parent_id=theirs)

    # 지정받은 사람이 남의 하위 폴더를 자기 개인 폴더로 가져가지 못한다(반대 방향도)
    r = await c.lead.patch(f"/api/folders/{sub}", json={"parent_id": theirs}, headers=hl)
    assert r.status_code == 403, r.text
    r = await c.lead.patch(f"/api/folders/{theirs_sub}", json={"parent_id": narrow}, headers=hl)
    assert r.status_code == 403
    assert (await c.member.get(f"/api/docs/{secret}")).status_code == 200  # 주인은 그대로 본다
    # 같은 주인의 다른 개인 폴더로도 못 옮긴다 — 볼 사람이 다르다(임원은 「좁게」를 못 본다)
    r = await c.lead.patch(f"/api/docs/{secret}", json={"folder_id": wide}, headers=hl)
    assert r.status_code == 403
    r = await c.lead.patch(f"/api/folders/{sub}", json={"parent_id": wide}, headers=hl)
    assert r.status_code == 403
    assert (await c.exec.get(f"/api/docs/{secret}")).status_code == 403
    # 주인은 자기 개인 폴더 사이로 옮긴다 — 옮기면 그 폴더의 볼 사람이 본다
    r = await c.member.patch(f"/api/docs/{secret}", json={"folder_id": wide}, headers=hm)
    assert r.status_code == 200
    assert (await c.exec.get(f"/api/docs/{secret}")).status_code == 200
    # 주인은 하위 폴더도 자기 개인 폴더 사이로 옮긴다
    r = await c.member.patch(f"/api/folders/{sub}", json={"parent_id": wide}, headers=hm)
    assert r.status_code == 200, r.text
    # 안에서 옮기는 것은 지정받은 사람도 된다
    inner = await folder(c.member, hm, title="넓게 하위", parent_id=wide)
    r = await c.lead.patch(f"/api/docs/{secret}", json={"folder_id": inner}, headers=hl)
    assert r.status_code == 200

    # 잠금: 개인 폴더의 문서는 주인만 잠그고 푼다 — 지정받은 임원도 못 하고, 주인은 임원이 아니어도 된다
    r = await c.exec.patch(f"/api/docs/{secret}", json={"locked": True}, headers=he)
    assert r.status_code == 403
    r = await c.member.patch(f"/api/docs/{secret}", json={"locked": True}, headers=hm)
    assert r.status_code == 200 and r.json()["locked"] is True
    r = await c.member.patch(f"/api/docs/{secret}", json={"locked": False}, headers=hm)
    assert r.status_code == 200
    # 지정받은 임원의 영구 삭제도 403
    assert (await c.exec.delete(f"/api/docs/{secret}", headers=he)).status_code == 204
    assert (await c.exec.delete(f"/api/docs/{secret}?hard=1", headers=he)).status_code == 403

    # AI 봇은 볼 사람으로 못 고른다(채팅 /ai 의 답으로 새지 않게)
    from app.ai import chat_command

    bot = await chat_command.ai_user(app_db)
    r = await c.member.patch(
        f"/api/folders/{wide}", json={"allowed_users": [str(bot.id)]}, headers=hm
    )
    assert r.status_code == 422
