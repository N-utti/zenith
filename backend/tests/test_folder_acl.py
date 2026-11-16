"""README 57 — 폴더 등급 + 사람 지정. 트리·상세·검색·AI·yjs·파일·자료실·홈이 전부 서버에서 걸러지고, 설정은 임원만."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx_ws import aconnect_ws
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
    # 최상위에만, 등급·사람 지정과 같이는 안 된다(임원이어도 422)
    for body in (
        {"title": "x", "private": True, "parent_id": str(s.wiki.id)},
        {"title": "x", "private": True, "min_role": "exec"},
        {"title": "x", "private": True, "allowed_users": [str(users.lead.id)]},
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
    assert r.status_code == 422
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
