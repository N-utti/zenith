"""임베딩·벡터 색인 경계(README 45, AI 어시스턴트 3단계). Ollama 의 `/api/embed`(bge-m3, 사내 compose 컨테이너)로
문서 본문 청크와 질문을 1024차원 벡터로 바꾼다 — 사내망 호출이지만 외부 공급자 경계(provider.py) 옆에 둔다.
`settings.embed_url` 이 비면 전부 꺼진다(`enabled()` False): 색인은 아무것도 안 하고 검색은 핵심어(FTS)만 쓴다.

색인 단위는 `doc_chunks`(03 §2.2): 문서 하나를 글자 수로 잘라(겹침 있음) 청크마다 벡터 한 줄. 문서가 저장될 때마다
(`yjs.save_room`) 디바운스 뒤 그 문서를 통째로 다시 색인한다(지우고 넣기). 게시글은 색인하지 않는다 — FTS 그대로."""

import asyncio
import logging
import uuid

import httpx
from sqlalchemy import delete, select

from app.config import settings
from app.db import session_scope
from app.models import EMBEDDING_DIM, DocChunk, Document

log = logging.getLogger("zenith.ai")

# ponytail: 글자 수로 자르고 앞뒤를 겹친다. 문단 경계·토큰 수 기준은 검색 품질이 아쉬울 때(실제 규정 문서로 재 본 뒤).
CHUNK_CHARS = 500
CHUNK_OVERLAP = 100
MAX_CHUNKS = 400  # 문서당 상한(20만 자) — 그 뒤는 색인되지 않는다. 한 번에 400개 임베딩은 bge-m3 CPU 로 수십 초
DEBOUNCE_S = 5.0  # 저장이 잇따르면(30초 주기 저장·퇴장 저장) 마지막 것만 색인
EMBED_TIMEOUT_S = 120.0
# 테스트가 끼우는 전송 계층(httpx.MockTransport). None 이면 실제 네트워크.
transport: httpx.AsyncBaseTransport | None = None


def enabled() -> bool:
    return bool(settings.embed_url)


def chunks(text: str) -> list[str]:
    """본문을 CHUNK_CHARS 글자 조각으로, 조각 사이는 CHUNK_OVERLAP 만큼 겹친다. 빈 조각은 뺀다."""
    text = text.strip()
    out: list[str] = []
    step = CHUNK_CHARS - CHUNK_OVERLAP
    for start in range(0, len(text), step):
        piece = text[start : start + CHUNK_CHARS].strip()
        if piece:
            out.append(piece)
        if start + CHUNK_CHARS >= len(text):
            break
    return out[:MAX_CHUNKS]


async def embed(texts: list[str]) -> list[list[float]]:
    """Ollama `/api/embed` — 글 목록을 같은 순서의 벡터 목록으로. 모양이 다르면(모델이 다르거나 응답이 잘림) 예외."""
    if not texts:
        return []
    assert settings.embed_url  # enabled() 를 먼저 본다
    async with httpx.AsyncClient(
        base_url=settings.embed_url, timeout=EMBED_TIMEOUT_S, transport=transport
    ) as client:
        r = await client.post("/api/embed", json={"model": settings.embed_model, "input": texts})
        r.raise_for_status()
        vectors = r.json().get("embeddings")
    if (
        not isinstance(vectors, list)
        or len(vectors) != len(texts)
        or any(len(v) != EMBEDDING_DIM for v in vectors)
    ):
        raise ValueError(
            f"임베딩 응답 모양이 다르다(모델 {settings.embed_model}, {EMBEDDING_DIM}차원 기대)"
        )
    return vectors


async def reindex(doc_id: uuid.UUID) -> int:
    """문서 하나를 다시 색인한다 — 옛 청크를 지우고 지금 본문으로 넣는다. 휴지통·없는 문서·빈 본문이면 청크 0.
    넣은 청크 수를 돌려준다. 임베딩을 기다리는 동안 DB 세션은 쥐지 않는다.
    ponytail: 같은 문서를 두 곳에서 동시에 색인하면(백필 스크립트 + 편집 저장) 청크가 겹쳐 들어갈 수 있다 —
    검색은 문서 단위로 접으므로 해는 없고, 다음 저장이 지운다. 유일 제약(doc_id, chunk_no)은 그게 거슬릴 때."""
    async with session_scope() as db:
        row = (
            await db.execute(
                select(Document.text_cache, Document.deleted_at).where(Document.id == doc_id)
            )
        ).first()
    text = row[0] if row is not None and row[1] is None else None
    pieces = chunks(text or "")
    vectors = await embed(pieces)
    async with session_scope() as db:
        try:
            await db.execute(delete(DocChunk).where(DocChunk.doc_id == doc_id))
            db.add_all(
                DocChunk(doc_id=doc_id, chunk_no=i, chunk_text=p, embedding=v, acl_role="member")
                for i, (p, v) in enumerate(zip(pieces, vectors, strict=True))
            )  # acl_role: 문서에는 열람 등급이 없다(03) — 전원 'member'
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    return len(pieces)


_pending: dict[uuid.UUID, asyncio.Task] = {}


def schedule(doc_id: uuid.UUID) -> None:
    """저장 뒤 DEBOUNCE_S 안에 또 저장되면 한 번만 색인한다. 실패는 로그만 — 다음 저장 때 다시 한다.
    ponytail: 프로세스 메모리의 태스크 — worker 1개 전제(yjs 릴레이와 같다). 종료 때 기다리지 않는다(다음 저장이 메운다)."""
    if not enabled():
        return
    old = _pending.pop(doc_id, None)
    if old is not None:
        old.cancel()
    task = asyncio.get_running_loop().create_task(_later(doc_id))
    _pending[doc_id] = task
    task.add_done_callback(
        lambda t: _pending.pop(doc_id, None) if _pending.get(doc_id) is t else None
    )


async def _later(doc_id: uuid.UUID) -> None:
    await asyncio.sleep(DEBOUNCE_S)
    try:
        n = await reindex(doc_id)
        log.info("벡터 색인 %s: 청크 %d", doc_id, n)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 — Ollama 가 죽었거나 모델이 없다. 검색은 FTS 로 계속 돈다
        log.exception("벡터 색인 실패 %s", doc_id)
