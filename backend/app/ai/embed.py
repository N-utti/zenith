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
EMBED_TIMEOUT_S = 120.0  # 색인(최대 400조각)
QUERY_TIMEOUT_S = (
    8.0  # 질문 1건 — 넘으면 FTS 만으로 답한다(Ollama 가 색인으로 바쁠 때 답변이 멈추지 않게)
)
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


async def embed(texts: list[str], *, timeout: float = EMBED_TIMEOUT_S) -> list[list[float]]:
    """Ollama `/api/embed` — 글 목록을 같은 순서의 벡터 목록으로. 모양이 다르면(모델이 다르거나 응답이 잘림) 예외."""
    if not texts:
        return []
    assert settings.embed_url  # enabled() 를 먼저 본다
    async with httpx.AsyncClient(
        base_url=settings.embed_url, timeout=timeout, transport=transport
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
    본문이 지난 색인과 같으면 임베딩 없이 그대로 둔다(서식만 바뀐 저장). 넣은 청크 수를 돌려준다.
    임베딩을 기다리는 동안 DB 세션은 쥐지 않는다. 임베딩이 실패해도 옛 청크는 지운다 — 사용자가 지운 글이
    근거로 남지 않게(보안 리뷰). 그 문서는 다음 저장이나 `reindex.py --missing` 이 다시 채운다.
    ponytail: 백필 스크립트(다른 프로세스)와 편집 저장이 겹치면 옛 본문이 새 본문을 덮을 수 있다 —
    다음 저장이나 스크립트 재실행이 고친다. 유일 제약(doc_id, chunk_no)·버전 비교는 그게 거슬릴 때."""
    async with session_scope() as db:
        row = (
            await db.execute(
                select(Document.text_cache, Document.deleted_at).where(Document.id == doc_id)
            )
        ).first()
        old = list(
            await db.scalars(
                select(DocChunk.chunk_text)
                .where(DocChunk.doc_id == doc_id)
                .order_by(DocChunk.chunk_no)
            )
        )
    text = row[0] if row is not None and row[1] is None else None
    pieces = chunks(text or "")
    if pieces and pieces == old:
        return len(pieces)
    failure: Exception | None = None
    try:
        vectors = await embed(pieces)
    except Exception as e:  # noqa: BLE001 — 옛 청크를 지운 뒤 다시 던진다
        vectors, failure = [], e
    async with session_scope() as db:
        try:
            # 문서 행을 잠근다(FOR KEY SHARE) — 영구 삭제(`_purge` 의 FOR UPDATE)와 순서가 직렬화돼 FK 위반이
            # 없고, 임베딩하는 사이 휴지통으로 갔으면 청크를 비우기만 한다
            alive = await db.scalar(
                select(Document.id)
                .where(Document.id == doc_id, Document.deleted_at.is_(None))
                .with_for_update(key_share=True)
            )
            await db.execute(delete(DocChunk).where(DocChunk.doc_id == doc_id))
            if alive is not None and failure is None:
                db.add_all(
                    DocChunk(
                        doc_id=doc_id, chunk_no=i, chunk_text=p, embedding=v, acl_role="member"
                    )
                    for i, (p, v) in enumerate(zip(pieces, vectors, strict=True))
                )  # acl_role: 문서에는 열람 등급이 없다(03) — 전원 'member'
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    if failure is not None:
        raise failure
    return len(pieces) if alive is not None else 0


_pending: dict[uuid.UUID, asyncio.Task] = {}  # 디바운스 중(아직 잠자는) 태스크만
_running: set[asyncio.Task] = set()  # 색인 중인 태스크 — 이벤트 루프는 태스크를 약하게만 잡는다
_index_lock = (
    asyncio.Lock()
)  # ponytail: Ollama 가 하나라 색인은 한 번에 하나. worker 를 늘리면 큐(Redis)로


def schedule(doc_id: uuid.UUID) -> None:
    """저장 뒤 DEBOUNCE_S 안에 또 저장되면 한 번만 색인한다. 잠자는 예약만 취소한다 — 이미 색인 중이면
    그대로 끝내고(끊어도 Ollama 쪽 계산은 남는다) 새 예약이 뒤에 선다. 실패는 로그만 — 다음 저장 때 다시.
    ponytail: 프로세스 메모리의 태스크 — worker 1개 전제(yjs 릴레이와 같다). 종료 때 기다리지 않는다(다음 저장이 메운다)."""
    if not enabled():
        return
    old = _pending.pop(doc_id, None)
    if old is not None:
        old.cancel()
    task = asyncio.get_running_loop().create_task(_later(doc_id))
    _pending[doc_id] = task
    _running.add(task)
    task.add_done_callback(_running.discard)


async def _later(doc_id: uuid.UUID) -> None:
    await asyncio.sleep(DEBOUNCE_S)
    _pending.pop(doc_id, None)  # 이제부터는 취소 대상이 아니다 — 새 저장은 새 예약으로
    async with _index_lock:
        try:
            n = await reindex(doc_id)
            log.info("벡터 색인 %s: 청크 %d", doc_id, n)
        except Exception:  # noqa: BLE001 — Ollama 가 죽었거나 모델이 없다. 검색은 FTS 로 계속 돈다
            log.exception("벡터 색인 실패 %s", doc_id)
