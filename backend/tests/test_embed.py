"""README 45 — 벡터 색인(doc_chunks)·하이브리드 검색. Ollama 없이 돈다: 임베딩은 글자 2-gram 해시 벡터로 흉내 낸다."""

import asyncio
import math
import zlib
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.ai import embed
from app.ai.provider import get_provider
from app.config import settings
from app.models import EMBEDDING_DIM, DocChunk, Document
from app.routers.search import find_hits

from .conftest import Users, login
from .test_ai import SearchingProvider, _chat, _knowledge, share_scope


def fake_vector(text: str) -> list[float]:
    """글자 2-gram 을 해시해 칸에 세고 정규화 — 같은 낱말 조각을 나눠 가진 글끼리 가깝다('연차휴가' ↔ '연차는')."""
    v = [0.0] * EMBEDDING_DIM
    for a, b in zip(text, text[1:], strict=False):
        if not (a.isspace() or b.isspace()):
            v[zlib.crc32((a + b).encode()) % EMBEDDING_DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


@pytest.fixture
def fake_embedding(monkeypatch, app_db):
    """임베딩을 켜고(가짜 벡터) 색인이 테스트 세션을 쓰게 한다."""

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [fake_vector(t) for t in texts]

    @asynccontextmanager
    async def scope():
        yield app_db

    monkeypatch.setattr(settings, "embed_url", "http://fake:11434")
    monkeypatch.setattr(embed, "embed", fake_embed)
    monkeypatch.setattr(embed, "session_scope", scope)


def test_chunks_overlap_and_skip_blank() -> None:
    assert embed.chunks("") == [] and embed.chunks("   \n ") == []
    assert embed.chunks("짧다") == ["짧다"]
    text = "가" * 450 + "나" * 450
    pieces = embed.chunks(text)
    assert [len(p) for p in pieces] == [500, 500]  # 0~500, 400~900 — 끝이 닿으면 멈춘다
    assert pieces[1][:50] == "가" * 50  # 앞 조각의 끝 100자가 다음 조각의 머리
    assert embed.chunks("가" * 500) == ["가" * 500]  # 딱 맞으면 하나


async def test_embed_posts_to_ollama_and_checks_shape(monkeypatch) -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        seen.append({"url": str(request.url), **body})
        dim = EMBEDDING_DIM if body["model"] == "bge-m3" else 3
        return httpx.Response(200, json={"embeddings": [[0.1] * dim for _ in body["input"]]})

    monkeypatch.setattr(settings, "embed_url", "http://ollama:11434")
    monkeypatch.setattr(embed, "transport", httpx.MockTransport(handler))
    assert await embed.embed([]) == []
    vectors = await embed.embed(["가", "나"])
    assert len(vectors) == 2 and len(vectors[0]) == EMBEDDING_DIM
    assert seen[0]["url"] == "http://ollama:11434/api/embed"
    assert seen[0]["input"] == ["가", "나"] and seen[0]["model"] == "bge-m3"
    monkeypatch.setattr(settings, "embed_model", "other")  # 차원이 다른 모델 → 저장 전에 거른다
    with pytest.raises(ValueError):
        await embed.embed(["가"])


def test_disabled_without_url(monkeypatch) -> None:
    monkeypatch.setattr(settings, "embed_url", None)
    assert not embed.enabled()
    embed.schedule(None)  # 꺼져 있으면 태스크도 만들지 않는다(이벤트 루프 없이도 된다)
    assert not embed._pending


async def test_reindex_replaces_chunks_and_skips_trashed(
    users: Users, app_db, fake_embedding
) -> None:
    seeded = await _knowledge(app_db, users)
    doc = seeded["doc"]
    assert await embed.reindex(doc.id) == 1
    await embed.reindex(doc.id)  # 다시 색인해도 겹치지 않는다
    rows = (await app_db.execute(select(DocChunk).where(DocChunk.doc_id == doc.id))).scalars().all()
    assert len(rows) == 1 and rows[0].chunk_no == 0 and rows[0].acl_role == "member"
    assert (
        rows[0].chunk_text.startswith("연차는 매년 15일")
        and len(rows[0].embedding) == EMBEDDING_DIM
    )
    trashed = (
        await app_db.execute(select(Document).where(Document.title == "옛 휴가 규정"))
    ).scalar_one()
    assert await embed.reindex(trashed.id) == 0  # 휴지통 → 청크 0
    # 본문이 비면 옛 청크가 사라진다
    doc.text_cache = ""
    await app_db.flush()
    assert await embed.reindex(doc.id) == 0
    assert (await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == doc.id))) is None


async def _index_all(app_db) -> None:
    for doc_id in await app_db.scalars(select(Document.id)):
        await embed.reindex(doc_id)


async def test_hybrid_search_finds_by_vector_and_keeps_filters(
    users: Users, app_db, fake_embedding
) -> None:
    """FTS 가 0건인 붙여 쓴 복합어('연차휴가')도 벡터로 잡힌다. 휴지통·ai_source=false·폴더 범위는 벡터 쪽도 같다.
    둘 다 잡으면 FTS 스니펫(`**`)을, 벡터만 잡으면 청크 원문을 쓴다. vector=False(⌘K)는 그대로."""
    seeded = await _knowledge(app_db, users)
    await _index_all(app_db)
    me = users.member

    assert await find_hits(app_db, me, "연차휴가", {"doc"}, 6) == []  # FTS 만: 0건
    hits = await find_hits(
        app_db, me, "연차휴가", {"doc"}, 6, docs_ai_source_only=True, vector=True
    )
    titles = {h.title for h in hits}
    assert "휴가 규정" in titles and "연차 이월 세칙" in titles and "비품 신청" in titles
    assert "옛 휴가 규정" not in titles and "AI 가 정리한 연차 이월" not in titles
    assert all("**" not in h.snippet and h.to == f"/docs/{h.id}" for h in hits)

    scoped = await find_hits(
        app_db,
        me,
        "연차휴가",
        {"doc"},
        6,
        docs_ai_source_only=True,
        folder_id=seeded["root"].id,
        vector=True,
    )
    assert {h.title for h in scoped} == {"휴가 규정", "연차 이월 세칙"}

    both = await find_hits(app_db, me, "연차 이월", {"doc"}, 6, vector=True)
    hit = next(h for h in both if h.title == "휴가 규정")
    assert "**연차는**" in hit.snippet  # FTS 와 벡터 둘 다 잡음 → FTS 강조 스니펫
    assert len({h.to for h in both}) == len(both)  # 같은 문서가 두 번 나오지 않는다
    assert len(await find_hits(app_db, me, "연차", {"doc"}, 2, vector=True)) == 2  # limit 지킴


async def test_vector_failure_falls_back_to_fts(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    await _knowledge(app_db, users)

    async def broken(texts):
        raise httpx.ConnectError("ollama down")

    monkeypatch.setattr(embed, "embed", broken)
    hits = await find_hits(app_db, users.member, "연차 이월", {"doc"}, 6, vector=True)
    assert "휴가 규정" in {h.title for h in hits}
    assert await find_hits(app_db, users.member, "연차휴가", {"doc"}, 6, vector=True) == []


async def test_chat_tool_uses_vector(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch, fake_embedding
) -> None:
    """AI 도구는 벡터도 쓴다 — 모델이 '연차휴가' 로 물어도 문서가 근거로 간다(게시글은 FTS 만이라 빠진다)."""
    app.dependency_overrides[get_provider] = SearchingProvider
    SearchingProvider.turns, SearchingProvider.queries = [], ["연차휴가"]
    share_scope(monkeypatch, app_db)
    await _knowledge(app_db, users)
    await _index_all(app_db)
    await login(client, "sujin@zenith.co.kr")
    try:
        ev = await _chat(client, "연차휴가 며칠?")
    finally:
        SearchingProvider.queries = ["연차 이월"]
    assert ev[-1][0] == "done"
    result = SearchingProvider.turns[1][-1]["content"][0]["content"]
    assert "(문서) 인사 규정 › 휴가 규정: 연차는 매년 15일" in result
    assert "(게시글)" not in result and "옛 휴가 규정" not in result and "무제한" not in result


async def test_schedule_debounces_and_indexes(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    monkeypatch.setattr(embed, "DEBOUNCE_S", 0.05)
    seeded = await _knowledge(app_db, users)
    calls: list[object] = []
    real = embed.reindex

    async def counting(doc_id):
        calls.append(doc_id)
        return await real(doc_id)

    monkeypatch.setattr(embed, "reindex", counting)
    embed.schedule(seeded["doc"].id)
    embed.schedule(seeded["doc"].id)  # 디바운스 안의 둘째 예약은 첫째를 대신한다
    task = embed._pending[seeded["doc"].id]
    await task
    await asyncio.sleep(0)
    assert calls == [seeded["doc"].id] and not embed._pending
    assert (
        await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == seeded["doc"].id))
    ) is not None
