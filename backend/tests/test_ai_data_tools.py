"""README 56 — AI 열람 도구(근태·결재·자료실)는 질문자 권한 그대로 보고, 거부는 acl.denied 로 남긴다."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app import storage
from app.ai import data_tools
from app.ai.provider import ToolCall, get_provider
from app.models import AuditEvent, Channel, ChannelMember, Message, StoredFile, User, Workspace
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai import SearchingProvider, _chat, share_scope
from .test_approvals import _as, draft, post


@pytest.fixture
async def c(make_client, users: Users):
    async with (
        _as(make_client, "sujin@zenith.co.kr") as member,
        _as(make_client, "donghyun@zenith.co.kr") as lead,
        _as(make_client, "jaeho@zenith.co.kr") as exec_,
    ):
        yield SimpleNamespace(member=member, lead=lead, exec=exec_)


async def _denials(app_db, actor_id):
    rows = await app_db.execute(
        select(AuditEvent).where(AuditEvent.kind == "acl.denied", AuditEvent.actor_id == actor_id)
    )
    return [e.detail for e in rows.scalars().all()]


async def test_attendance_tool_follows_role(c, users: Users, app_db, monkeypatch) -> None:
    share_scope(monkeypatch, app_db)
    monkeypatch.setattr(data_tools, "session_scope", ai.session_scope)  # 도구도 테스트 세션으로
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-04", "end_date": "2030-03-08"},
    )
    assert r.status_code == 201, r.text
    out = await data_tools.run(
        users.member, "attendance", {"month": "2030-03", "who": "me"}, budget=50_000, via="test"
    )
    assert "is_error" not in out, out
    assert "2030-03 김수진 근태" in out["content"] and "연차: 부여 15" in out["content"]
    assert "annual 2030-03-04~2030-03-08 5.0일 pending" in out["content"]
    # 사원이 팀 근태를 보면 거부 + 감사
    out = await data_tools.run(
        users.member, "attendance", {"month": "2030-03", "who": "team"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True and "열람 권한" in out["content"]
    assert {"path": "ai.attendance", "reason": "team", "via": "test"} in await _denials(
        app_db, users.member.id
    )
    # 팀장은 자기 팀, 전사는 임원만
    out = await data_tools.run(
        users.lead, "attendance", {"month": "2030-03", "who": "team"}, budget=50_000, via="test"
    )
    assert (
        "is_error" not in out and "개발팀 근태" in out["content"] and "- 김수진" in out["content"]
    )
    out = await data_tools.run(
        users.lead, "attendance", {"month": "2030-03", "who": "company"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True
    out = await data_tools.run(
        users.exec, "attendance", {"month": "2030-03", "who": "company"}, budget=50_000, via="test"
    )
    assert "is_error" not in out and "전사 근태" in out["content"]
    out = await data_tools.run(
        users.member, "attendance", {"month": "2030-3"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True and "YYYY-MM" in out["content"]


async def test_approvals_tools_follow_can_view(c, users: Users, app_db, monkeypatch) -> None:
    share_scope(monkeypatch, app_db)
    monkeypatch.setattr(data_tools, "session_scope", ai.session_scope)  # 도구도 테스트 세션으로
    r = await post(c.member, "/api/approvals/drafts", draft(title="워크숍 대관"))
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]
    r = await post(c.member, f"/api/approvals/{doc_id}/submit")
    assert r.status_code == 200, r.text
    # 팀장(결재선)의 받은 함에 보인다
    out = await data_tools.run(users.lead, "approvals", {"box": "inbox"}, budget=50_000, via="test")
    assert "is_error" not in out and f"id={doc_id}" in out["content"]
    assert "[general] 워크숍 대관 — pending, 기안 김수진" in out["content"]
    assert "금액 450,000원" in out["content"]
    # 상세 — 기안자·결재선은 보고, 영업팀 사원은 거부 + 감사
    out = await data_tools.run(
        users.member, "approval_detail", {"id": doc_id}, budget=50_000, via="test"
    )
    assert (
        "is_error" not in out
        and "본문:\n<결재 본문>\n세미나실 대관료\n</결재 본문>" in out["content"]
    )
    assert "1. 박동현 (approve) — waiting" in out["content"]
    other = User(
        name="이영희", email="yh@zenith.co.kr", pw_hash=users.member.pw_hash, role="member"
    )
    app_db.add(other)
    await app_db.flush()
    out = await data_tools.run(other, "approval_detail", {"id": doc_id}, budget=50_000, via="test")
    assert out["is_error"] is True and "열람 권한" in out["content"]
    assert {"path": "ai.approval_detail", "reason": "view", "via": "test"} in await _denials(
        app_db, other.id
    )
    # 참조함 — 상신된 문서의 참조자가 아니면 비어 있고, 기안자의 보낸 함엔 있다
    out = await data_tools.run(
        users.member, "approvals", {"box": "sent"}, budget=50_000, via="test"
    )
    assert f"id={doc_id}" in out["content"]
    out = await data_tools.run(
        users.lead, "approvals", {"box": "reference"}, budget=50_000, via="test"
    )
    assert out["content"].endswith("결재 문서가 없습니다.")
    # 한도 — 남은 예산보다 길면 자른다
    out = await data_tools.run(
        users.member, "approval_detail", {"id": doc_id}, budget=30, via="test"
    )
    assert len(out["content"]) < 80 and out["content"].endswith("(한도에 걸려 뒤를 잘랐다)")
    out = await data_tools.run(users.member, "approvals", {}, budget=0, via="test")
    assert out["is_error"] is True and "한도" in out["content"]
    out = await data_tools.run(other, "approvals", {"box": "sent"}, budget=50_000, via="test")
    assert out["content"].endswith("결재 문서가 없습니다.")
    out = await data_tools.run(
        users.member, "approval_detail", {"id": "nope"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True
    out = await data_tools.run(users.member, "approvals", {"box": "x"}, budget=50_000, via="test")
    assert out["is_error"] is True


@pytest.mark.usefixtures("minio_bucket")
async def test_archive_and_read_file_follow_download_rules(
    users: Users, app_db, monkeypatch
) -> None:
    share_scope(monkeypatch, app_db)
    monkeypatch.setattr(data_tools, "session_scope", ai.session_scope)  # 도구도 테스트 세션으로
    now = datetime.now(UTC)
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    general = Channel(ws_id=ws.id, name="일반", is_dm=False)
    secret = Channel(ws_id=ws.id, name="인사", is_dm=False, is_private=True)
    app_db.add_all([general, secret])
    await app_db.flush()
    app_db.add_all(
        [
            ChannelMember(channel_id=general.id, user_id=users.member.id),
            ChannelMember(channel_id=general.id, user_id=users.lead.id),
            ChannelMember(channel_id=secret.id, user_id=users.lead.id),
        ]
    )
    from app.routers.channels import attachment_key, attachment_url

    fid = "00000000-0000-0000-0000-000000000001"
    gen_url = attachment_url(general.id, fid, "회의록.txt")
    sec_url = attachment_url(secret.id, fid, "연봉.txt")
    await storage.put(
        attachment_key(general.id, fid, "회의록.txt"), "매매가 115억".encode(), "text/plain"
    )
    await storage.put(attachment_key(secret.id, fid, "연봉.txt"), "비밀".encode(), "text/plain")
    app_db.add_all(
        [
            Message(
                channel_id=general.id,
                author_id=users.lead.id,
                body="첨부",
                attachments=[
                    {"url": gen_url, "name": "회의록.txt", "size": 20, "content_type": "text/plain"}
                ],
                created_at=now - timedelta(minutes=5),
            ),
            Message(
                channel_id=secret.id,
                author_id=users.lead.id,
                body="첨부",
                attachments=[
                    {"url": sec_url, "name": "연봉.txt", "size": 4, "content_type": "text/plain"}
                ],
                created_at=now - timedelta(minutes=4),
            ),
        ]
    )
    await app_db.flush()
    # 자료실 — 사원은 일반 채널 것만, 팀장은 둘 다
    out = await data_tools.run(users.member, "archive", {}, budget=50_000, via="test")
    assert "회의록.txt" in out["content"] and "연봉.txt" not in out["content"]
    out = await data_tools.run(users.lead, "archive", {"query": "연봉"}, budget=50_000, via="test")
    assert "연봉.txt" in out["content"] and "회의록.txt" not in out["content"]
    # 본문 읽기 — 멤버만, 메시지에 실린 파일만
    out = await data_tools.run(
        users.member, "read_file", {"url": gen_url}, budget=50_000, via="test"
    )
    assert "is_error" not in out and "매매가 115억" in out["content"] and "<파일>" in out["content"]
    out = await data_tools.run(
        users.member, "read_file", {"url": sec_url}, budget=50_000, via="test"
    )
    assert out["is_error"] is True and "열람 권한" in out["content"]
    assert {"path": "ai.read_file", "reason": "member", "via": "test"} in await _denials(
        app_db, users.member.id
    )
    out = await data_tools.run(
        users.member,
        "read_file",
        {"url": attachment_url(general.id, fid, "없는.txt")},
        budget=50_000,
        via="test",
    )
    assert out["is_error"] is True and "없는 파일" in out["content"]
    out = await data_tools.run(
        users.member, "read_file", {"url": "https://evil/x"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True
    # 문서 파일(/api/files/{id}) — 자료실 목록과 같은 범위: 살아 있는 문서에 붙은 것만
    from app.models import Document, Folder

    folder = Folder(ws_id=ws.id, parent_id=None, title="루트")
    app_db.add(folder)
    await app_db.flush()
    doc = Document(folder_id=folder.id, title="실사 메모", updated_by=users.member.id)
    gone = Document(
        folder_id=folder.id, title="지운 문서", updated_by=users.member.id, deleted_at=now
    )
    app_db.add_all([doc, gone])
    await app_db.flush()
    sf = StoredFile(
        name="메모.md",
        size=5,
        content_type="text/markdown",
        uploader_id=users.lead.id,
        doc_id=doc.id,
    )
    orphan = StoredFile(
        name="고아.md", size=5, content_type="text/markdown", uploader_id=users.lead.id
    )
    trashed = StoredFile(
        name="지운.md",
        size=5,
        content_type="text/markdown",
        uploader_id=users.lead.id,
        doc_id=gone.id,
    )
    png = StoredFile(
        name="그림.png", size=5, content_type="image/png", uploader_id=users.lead.id, doc_id=doc.id
    )
    app_db.add_all([sf, orphan, trashed, png])
    await app_db.flush()
    for row in (sf, orphan, trashed, png):
        await storage.put(f"files/{row.id}", "# 메모".encode(), row.content_type)
    out = await data_tools.run(
        users.member, "read_file", {"url": f"/api/files/{sf.id}"}, budget=50_000, via="test"
    )
    assert "is_error" not in out and "# 메모" in out["content"]
    for row in (orphan, trashed):
        out = await data_tools.run(
            users.member, "read_file", {"url": f"/api/files/{row.id}"}, budget=50_000, via="test"
        )
        assert out["is_error"] is True and "없는 파일" in out["content"], row.name
    out = await data_tools.run(
        users.member, "read_file", {"url": f"/api/files/{png.id}"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True and "읽을 수 없는 형식" in out["content"]
    out = await data_tools.run(
        users.member, "read_file", {"url": f"/api/files/{sf.id}\n"}, budget=50_000, via="test"
    )
    assert out["is_error"] is True  # fullmatch — 끝의 줄바꿈도 거절


async def test_chat_offers_data_tools_but_check_does_not(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    class Asking(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            SearchingProvider.tools_seen.append(tools)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(ToolCall(id="a", name="attendance", input={"who": "me"}))
                return
            yield "이번 달 근태를 봤습니다."

    app.dependency_overrides[get_provider] = Asking
    SearchingProvider.turns, SearchingProvider.tools_seen = [], []
    share_scope(monkeypatch, app_db)
    monkeypatch.setattr(data_tools, "session_scope", ai.session_scope)  # 도구도 테스트 세션으로
    await login(client, "sujin@zenith.co.kr")
    ev = await _chat(client, "이번 달 내 근태 어때?")
    names = [t["name"] for t in SearchingProvider.tools_seen[0]]
    assert names[-5:] == ["attendance", "approvals", "approval_detail", "archive", "read_file"]
    assert ("status", {"text": "자료를 보는 중"}) in ev
    result = SearchingProvider.turns[-1][-1]["content"][0]
    assert "is_error" not in result and "김수진 근태" in result["content"]
    assert ev[-1][0] == "done"
    SearchingProvider.tools_seen = []
    await client.post("/api/ai/check", json={"text": "연차는 15일"}, headers=csrf(client))
    assert "attendance" not in [t["name"] for t in SearchingProvider.tools_seen[0]]
