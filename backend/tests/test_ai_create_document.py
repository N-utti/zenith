"""AI 문서 만들기(README 69) — /ai/chat 의 create_document 도구. 새 문서만, 질문자가 볼 수 있는 폴더에만."""

import uuid

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select

from app.ai.provider import ToolCall
from app.models import AuditEvent, Document, Folder, Workspace
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai import _chat, share_scope
from .test_ai_rules import SearchingProvider, _reset
from .test_docs_import import ydoc_fragment

HTML = (
    "<h1>3분기 보고</h1><p>매출이 <strong>늘었다</strong>.</p><script>alert(1)</script>"
    '<table><tr><th>월</th><th>매출</th></tr><tr><td>7월</td><td onclick="x()">120</td></tr></table>'
)


async def _folders(app_db) -> tuple[Folder, Folder, Folder]:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    plan = Folder(ws_id=ws.id, parent_id=root.id, title="기획")
    leads = Folder(ws_id=ws.id, parent_id=root.id, title="팀장방", min_role="lead")
    app_db.add_all([plan, leads])
    await app_db.flush()
    await app_db.commit()
    return root, plan, leads


def _calling(*calls: ToolCall):
    """첫 턴에 주어진 도구 호출을 내고, 도구 결과가 오면 마지막(성공한) 결과의 링크를 답에 넣는 공급자."""

    class Provider(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            SearchingProvider.tools_seen.append(tools)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(*calls)
                return
            ok = [
                r["content"]
                for r in last
                if r.get("type") == "tool_result" and "넣습니다: " in r["content"]
            ]
            yield (
                "만들었습니다. " + ok[0].partition("넣습니다: ")[2]
                if ok
                else "어느 폴더에 만들까요?"
            )

    return Provider


def _start(app: FastAPI, monkeypatch, app_db, provider) -> None:
    _reset(app, provider)
    share_scope(monkeypatch, app_db)
    SearchingProvider.turns, SearchingProvider.tools_seen = [], []
    ai._ai_calls.clear()


def _results() -> dict[str, dict]:
    return {r["tool_use_id"]: r for r in SearchingProvider.turns[-1][-1]["content"]}


async def test_chat_creates_document(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """모델이 create_document 를 부르면 질문자 이름으로 새 문서가 생긴다 — 본문은 필터를 지나고(script·onclick 제거),
    맨 위에 AI 초안 표시, AI 근거 스위치는 꺼짐, 감사 기록. 못 보는 폴더는 「없는 폴더」, 한 답변에 하나."""
    _, plan, _ = await _folders(app_db)
    _start(
        app,
        monkeypatch,
        app_db,
        _calling(
            # 팀장 전용 폴더 — member 에게는 없는 폴더다(이름도 목록에 안 나온다)
            ToolCall(
                id="hidden",
                name="create_document",
                input={"title": "x", "html": HTML, "folder": "팀장방"},
            ),
            ToolCall(
                id="ok",
                name="create_document",
                input={"title": " 3분기\n보고](x) ", "html": HTML, "folder": "회사 위키/기획"},
            ),
            ToolCall(
                id="again",
                name="create_document",
                input={"title": "y", "html": HTML, "folder": "기획"},
            ),
        ),
    )
    await login(client, "sujin@zenith.co.kr")
    ev = await _chat(client, "3분기 보고를 기획 폴더에 문서로 만들어 줘")
    assert "create_document" in [t["name"] for t in SearchingProvider.tools_seen[0]]
    assert ("status", {"text": "문서를 만드는 중"}) in ev
    res = _results()
    assert res["hidden"]["is_error"] is True and "그런 폴더가 없습니다" in res["hidden"]["content"]
    assert "회사 위키/기획" in res["hidden"]["content"] and "팀장방" not in res["hidden"]["content"]
    assert (
        "is_error" not in res["ok"]
        and "「회사 위키/기획」 폴더에 만들었습니다" in res["ok"]["content"]
    )
    assert res["again"]["is_error"] is True and "하나만" in res["again"]["content"]

    docs = (await app_db.execute(select(Document))).scalars().all()
    assert len(docs) == 1
    doc = docs[0]
    assert (doc.folder_id, doc.title, doc.updated_by) == (
        plan.id,
        "3분기 보고](x)",
        users.member.id,
    )
    assert doc.ai_source is False  # AI 가 쓴 글이 다음 답의 근거로 돌지 않는다
    assert "AI 어시스턴트가 작성한 초안" in doc.text_cache and "늘었다" in doc.text_cache
    assert "alert" not in doc.text_cache
    frag = ydoc_fragment(doc.ydoc_snapshot)
    assert frag.startswith("<paragraph><italic>AI 어시스턴트가 작성한 초안입니다.")
    assert '<heading level="1">3분기 보고</heading>' in frag and "<table>" in frag
    assert "onclick" not in frag and "script" not in frag
    answer = "".join(d["text"] for e, d in ev if e == "token")
    assert f"[📄 3분기 보고］(x）](/docs/{doc.id})" in answer  # 링크 문법을 깨는 글자는 전각으로
    audit_ev = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.doc_create"))
    assert audit_ev.actor_id == users.member.id and audit_ev.target_id == doc.id
    assert audit_ev.detail["folder"] == str(plan.id)
    # 편집기 초기 로드 — 만든 문서를 바로 연다
    r = await client.get(f"/api/docs/{doc.id}")
    assert r.status_code == 200 and r.json()["ydoc"] is not None
    # 팩트체커에는 문서 만들기 도구가 없다
    SearchingProvider.tools_seen = []
    await client.post("/api/ai/check", json={"text": "연차는 15일"}, headers=csrf(client))
    assert "create_document" not in [t["name"] for t in SearchingProvider.tools_seen[0]]


async def test_create_document_folder_rules_and_limits(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """폴더를 못 정하면 만들지 않고 목록을 준다(모델이 사용자에게 묻는다). 질문 범위 폴더가 있으면 거기에. 하루 상한."""
    root, plan, leads = await _folders(app_db)
    call = ToolCall(id="c", name="create_document", input={"title": "메모", "html": "<p>본문</p>"})
    _start(app, monkeypatch, app_db, _calling(call))
    await login(client, "sujin@zenith.co.kr")
    await _chat(client, "메모를 문서로 만들어 줘")
    res = _results()["c"]
    assert res["is_error"] is True and "어디에 만들지 묻습니다" in res["content"]
    assert "- 회사 위키\n- 회사 위키/기획" in res["content"] and "팀장방" not in res["content"]
    assert await app_db.scalar(select(func.count(Document.id))) == 0

    # 질문 범위(scope = 폴더 id)가 있으면 folder 없이도 그 폴더에
    SearchingProvider.turns = []
    await _chat(client, "메모를 문서로 만들어 줘", scope=str(plan.id))
    assert "is_error" not in _results()["c"]
    doc = await app_db.scalar(select(Document))
    assert doc.folder_id == plan.id

    # 하루 상한 — 감사 기록으로 센다
    monkeypatch.setattr(ai, "AI_DOCS_PER_DAY", 1)
    SearchingProvider.turns = []
    await _chat(client, "하나 더", scope=str(plan.id))
    res = _results()["c"]
    assert res["is_error"] is True and "문서 수를 넘었습니다" in res["content"]
    assert await app_db.scalar(select(func.count(Document.id))) == 1


def test_pick_folder_names() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    paths = {a: "위키/기획", b: "영업/기획", c: "영업"}
    assert ai._pick_folder(paths, " 영업 ", None) == c
    assert ai._pick_folder(paths, "/위키/기획/", None) == a
    assert "여럿" in ai._pick_folder(paths, "기획", None)  # 끝 이름이 겹치면 고르지 않는다
    assert ai._pick_folder(paths, None, b) == b
    assert "묻습니다" in ai._pick_folder(paths, None, uuid.uuid4())  # 못 보는 범위 폴더
    assert "폴더가 없습니다" in ai._pick_folder({}, "x", None)
