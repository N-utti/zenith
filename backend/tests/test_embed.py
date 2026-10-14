"""README 45 — 벡터 색인(doc_chunks)·하이브리드 검색. Ollama 없이 돈다: 임베딩은 글자 2-gram 해시 벡터로 흉내 낸다."""

import asyncio
import math
import zlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.ai import embed
from app.ai.provider import get_provider
from app.config import settings
from app.models import EMBEDDING_DIM, DocChunk, Document
from app.routers import search
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
async def fake_embedding(monkeypatch, app_db):
    """임베딩을 켜고(가짜 벡터) 색인이 테스트 세션을 쓰게 한다. 가짜 벡터는 서로 멀어서(코사인 거리 0.8~1)
    거리 상한을 사실상 끈다 — 상한 자체는 test_distance_cap 이 본다."""

    async def fake_embed(texts: list[str], **_) -> list[list[float]]:
        return [fake_vector(t) for t in texts]

    @asynccontextmanager
    async def scope():
        yield app_db

    monkeypatch.setattr(settings, "embed_url", "http://fake:11434")
    monkeypatch.setattr(embed, "embed", fake_embed)
    monkeypatch.setattr(embed, "session_scope", scope)
    monkeypatch.setattr(search, "MAX_COSINE_DIST", 2.0)
    yield
    for task in list(embed._running):  # 앞 테스트가 남긴 태스크가 다음 테스트로 새지 않게
        task.cancel()
    embed._pending.clear()


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
        dim = EMBEDDING_DIM if body["model"] == "bge-m3:567m" else 3
        return httpx.Response(200, json={"embeddings": [[0.1] * dim for _ in body["input"]]})

    monkeypatch.setattr(settings, "embed_url", "http://ollama:11434")
    monkeypatch.setattr(embed, "transport", httpx.MockTransport(handler))
    assert await embed.embed([]) == []
    vectors = await embed.embed(["가", "나"])
    assert len(vectors) == 2 and len(vectors[0]) == EMBEDDING_DIM
    assert seen[0]["url"] == "http://ollama:11434/api/embed"
    assert seen[0]["input"] == ["가", "나"] and seen[0]["model"] == "bge-m3:567m"
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
    # 토큰이 없는 질문(기호만)은 FTS 를 건너뛰고 벡터만 — 꺼져 있으면 예전처럼 빈 목록
    assert await find_hits(app_db, me, "?!", {"doc", "post"}, 6, vector=True) != []
    assert await find_hits(app_db, me, "?!", {"doc", "post"}, 6) == []
    # 게시글은 FTS 만
    assert await find_hits(app_db, me, "연차휴가", {"post"}, 6, vector=True) == []


async def test_distance_cap_drops_unrelated(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    """kNN 은 멀어도 limit 를 채운다 — 상한 밖은 버린다. 가짜 벡터로는 조각 원문과 같은 질문만 가깝다(거리 0)."""
    seeded = await _knowledge(app_db, users)
    await _index_all(app_db)
    monkeypatch.setattr(search, "MAX_COSINE_DIST", 0.5)
    me = users.member
    assert await find_hits(app_db, me, "?!", {"doc"}, 6, vector=True) == []
    assert await find_hits(app_db, me, "연차휴가", {"doc"}, 6, vector=True) == []
    text = (await app_db.get(Document, seeded["doc"].id)).text_cache
    hits = await find_hits(app_db, me, text, {"doc"}, 6, vector=True)
    assert [h.title for h in hits][:1] == ["휴가 규정"]


async def test_trashed_doc_with_leftover_chunks_is_filtered(
    users: Users, app_db, fake_embedding
) -> None:
    """휴지통으로 가도 청크는 남는다 — 조인 필터가 거른다(보안 리뷰 L1)."""
    seeded = await _knowledge(app_db, users)
    doc = seeded["doc"]
    await embed.reindex(doc.id)
    doc.deleted_at = datetime.now(UTC)
    await app_db.flush()
    hits = await find_hits(app_db, users.member, "연차휴가", {"doc"}, 6, vector=True)
    assert doc.id not in {h.id for h in hits}
    assert (await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == doc.id))) is not None


async def test_index_failure_drops_old_chunks_and_logs(
    users: Users, app_db, fake_embedding, monkeypatch, caplog
) -> None:
    """임베딩이 실패하면 옛 청크를 지운다(지운 글이 근거로 남지 않게) — 예약 경로는 로그만 남기고 끝난다."""
    seeded = await _knowledge(app_db, users)
    doc = seeded["doc"]
    await embed.reindex(doc.id)

    async def broken(texts, **_):
        raise httpx.ConnectError("ollama down")

    monkeypatch.setattr(embed, "embed", broken)
    doc.text_cache = "비밀번호를 지운 새 본문"  # 본문이 바뀌어야 임베딩을 부른다
    await app_db.flush()
    with pytest.raises(httpx.ConnectError):
        await embed.reindex(doc.id)
    assert (await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == doc.id))) is None
    monkeypatch.setattr(embed, "DEBOUNCE_S", 0.01)
    embed.schedule(doc.id)
    await embed._pending[doc.id]
    assert not embed._pending and "벡터 색인 실패" in caplog.text


async def test_unchanged_text_skips_embedding(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    seeded = await _knowledge(app_db, users)
    assert await embed.reindex(seeded["doc"].id) == 1
    calls = []

    async def counting(texts, **_):
        calls.append(texts)
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(embed, "embed", counting)
    assert await embed.reindex(seeded["doc"].id) == 1
    assert calls == []  # 본문이 같다 — Ollama 를 부르지 않는다


async def test_running_index_is_not_cancelled_by_new_save(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    """색인 중에 또 저장되면 끊지 않고 끝낸 뒤 새 예약이 뒤에 선다(한 번에 하나)."""
    seeded = await _knowledge(app_db, users)
    doc_id = seeded["doc"].id
    gate = asyncio.Event()
    calls: list[int] = []

    async def slow(texts, **_):
        calls.append(len(texts))
        await gate.wait()
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(embed, "embed", slow)
    monkeypatch.setattr(embed, "DEBOUNCE_S", 0.01)
    embed.schedule(doc_id)
    first = embed._pending[doc_id]
    deadline = asyncio.get_running_loop().time() + 5
    while not calls and asyncio.get_running_loop().time() < deadline:  # 고정 sleep 은 전체 실행 부하에서 깨졌다
        await asyncio.sleep(0.01)
    assert not embed._pending and calls == [1]  # 디바운스를 지나 임베딩 대기 중
    embed.schedule(doc_id)  # 두 번째 저장 — 첫째를 끊지 않는다
    second = embed._pending[doc_id]
    gate.set()
    await first
    await second
    assert not first.cancelled() and calls == [1]  # 둘째는 본문이 같아 임베딩을 건너뛴다
    assert (await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == doc_id))) is not None


async def test_vector_failure_falls_back_to_fts(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    await _knowledge(app_db, users)

    async def broken(texts, **_):
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
    first = embed._pending[seeded["doc"].id]
    embed.schedule(seeded["doc"].id)  # 디바운스 안의 둘째 예약은 첫째를 대신한다
    task = embed._pending[seeded["doc"].id]
    await task
    assert first.cancelled() and calls == [seeded["doc"].id] and not embed._pending
    assert (
        await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == seeded["doc"].id))
    ) is not None


async def test_reindex_sends_batches_and_fails_closed_midway(
    users: Users, app_db, fake_embedding, monkeypatch
) -> None:
    """17조각 이상이면 EMBED_BATCH 씩 나눠 보낸다. 둘째 묶음이 실패하면 청크는 0개(옛 것도 지움), 예외는 다시 던진다."""
    seeded = await _knowledge(app_db, users)
    doc = seeded["doc"]
    doc.text_cache = "가나다라마바사 아자차카타파하. " * 700  # 500자 조각 20개쯤
    await app_db.commit()
    sizes: list[int] = []

    async def second_batch_breaks(texts, **_):
        sizes.append(len(texts))
        if len(sizes) == 2:
            raise httpx.ConnectError("ollama down")
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(embed, "embed", second_batch_breaks)
    with pytest.raises(httpx.ConnectError):
        await embed.reindex(doc.id)
    assert len(sizes) == 2 and all(n <= embed.EMBED_BATCH for n in sizes) and sizes[0] == embed.EMBED_BATCH
    assert (await app_db.scalar(select(DocChunk).where(DocChunk.doc_id == doc.id))) is None
