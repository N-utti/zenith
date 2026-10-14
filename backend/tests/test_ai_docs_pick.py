"""참고 문서 선택 `docs: [id…]` (README 50)."""

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select

from app.config import settings
from app.models import AiSession, Document
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai import _chat, _doc_with_text, _knowledge, share_scope
from .test_ai_rules import Answering, SearchingProvider, _reset


async def _post(client: AsyncClient, **body) -> tuple[int, dict | None]:
    r = await client.post("/api/ai/chat", json={"message": "?", **body}, headers=csrf(client))
    return r.status_code, (r.json() if r.status_code != 200 else None)


async def test_docs_go_into_one_block_in_order_with_cards(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    class Two(Answering):
        answer = "이월은 5일[[1]], 세칙은 상반기[[2]]"

    _reset(app, Two)
    share_scope(monkeypatch, app_db)
    seeded = await _knowledge(app_db, users)
    child = await app_db.scalar(select(Document).where(Document.title == "연차 이월 세칙"))
    await login(client, "sujin@zenith.co.kr")
    ev = await _chat(client, "둘 다?", docs=[str(seeded["doc"].id), str(child.id)])
    block = SearchingProvider.systems[0][1]
    assert block["cache_control"] == {"type": "ephemeral"} and block["text"].startswith(
        ai.DOC_PROMPT
    )
    assert (
        "[1] 《휴가 규정》" in block["text"]
        and "[2] 《연차 이월 세칙》 이월 연차는 상반기" in block["text"]
    )
    assert block["text"].index("[1] 《휴가 규정》") < block["text"].index(
        "[2] 《연차 이월 세칙》"
    )  # 고른 순서
    citations = next(d for e, d in ev if e == "citations")
    assert [(c["n"], c["title"]) for c in citations] == [(1, "휴가 규정"), (2, "연차 이월 세칙")]
    assert citations[1]["to"] == f"/docs/{child.id}" and citations[1]["path"] == "세칙"


async def test_scope_doc_is_alias_and_merges_with_docs(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Answering)
    share_scope(monkeypatch, app_db)
    seeded = await _knowledge(app_db, users)
    doc_id = str(seeded["doc"].id)
    await login(client, "sujin@zenith.co.kr")
    await _chat(client, "?", scope=f"doc:{doc_id}", docs=[doc_id, doc_id])  # 같은 문서 — 한 번만
    block = SearchingProvider.systems[0][1]["text"]
    assert block.count("《휴가 규정》") == 1 and "[2]" not in block


async def test_docs_with_folder_scope_keeps_both(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Answering)
    share_scope(monkeypatch, app_db)
    seeded = await _knowledge(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    await _chat(client, "?", scope=str(seeded["other"].id), docs=[str(seeded["doc"].id)])
    system = SearchingProvider.systems[0]
    assert "<문서>" in system[1]["text"] and "검색 범위는 사용자가 고른 폴더" in system[-1]["text"]


async def test_docs_limits_and_switch(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Answering)
    share_scope(monkeypatch, app_db)
    seeded = await _knowledge(app_db, users)
    off = await app_db.scalar(select(Document).where(Document.title == "AI 가 정리한 연차 이월"))
    trashed = await app_db.scalar(select(Document).where(Document.title == "옛 휴가 규정"))
    ids = [str((await _doc_with_text(app_db, f"문서 {i}")).id) for i in range(ai.MAX_REF_DOCS + 1)]
    await login(client, "sujin@zenith.co.kr")
    status, out = await _post(client, docs=ids)
    assert status == 422 and out["detail"] == "참고 문서는 5개까지입니다."
    status, out = await _post(client, docs=[str(seeded["doc"].id), str(off.id)])
    assert status == 422 and out["detail"] == "AI 근거로 쓰기가 꺼진 문서입니다."
    for bad in (str(trashed.id), "00000000-0000-0000-0000-000000000000"):
        status, out = await _post(client, docs=[bad])
        assert status == 422 and out["detail"] == "없는 문서입니다.", bad
    status, out = await _post(client, scope="doc:abc", docs=[str(seeded["doc"].id)])
    assert (
        status == 422 and out["detail"] == "없는 문서입니다."
    )  # 잘못된 별칭은 정상 docs 가 있어도 422
    assert SearchingProvider.systems == []
    assert await app_db.scalar(select(func.count(AiSession.id))) == 0  # 전부 세션 저장 전
    status, out = await _post(client, docs=["abc"])
    assert status == 422  # UUID 가 아니다 — pydantic
    status, out = await _post(client, docs=ids * 5)
    assert status == 422  # 스키마 상한(MAX_REF_DOCS*4) — 파싱 전에 거른다
    five = ids[: ai.MAX_REF_DOCS]
    status, _ = await _post(
        client, scope=f"doc:{five[0]}", docs=five + five[:2]
    )  # 중복 섞인 5개 — 중복 제거 뒤 5
    assert status == 200


async def test_docs_share_one_character_budget(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Answering)
    share_scope(monkeypatch, app_db)
    await _knowledge(app_db, users)
    a = await _doc_with_text(app_db, "가" * 80)
    b = await _doc_with_text(app_db, "나" * 80)
    monkeypatch.setattr(settings, "ai_doc_max_chars", 100)
    await login(client, "sujin@zenith.co.kr")
    await _chat(client, "?", docs=[str(a.id), str(b.id)])
    block = SearchingProvider.systems[0][1]["text"]
    assert "가" * 80 in block and "나" * 20 in block and "나" * 21 not in block
    assert "(본문이 길어 앞 20자만 넣었다)" in block and block.count("본문이 길어") == 1
    c = await _doc_with_text(app_db, "다" * 10)
    SearchingProvider.systems = []
    await _chat(client, "?", docs=[str(a.id), str(b.id), str(c.id)])
    block = SearchingProvider.systems[0][1]["text"]
    assert (
        "(본문 한도를 다 써서 넣지 못했다: 《" in block and "[3]" not in block
    )  # 셋째는 번호·카드 없음
