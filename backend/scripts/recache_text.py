"""검색·AI 평문(text_cache·tsv) 백필(#391) — 살아 있는 문서의 Y.Doc 스냅샷에서 평문을 다시 뽑아 달라진 것만 적는다.

    uv run python scripts/recache_text.py

`_plain_text` 가 바뀌었을 때(예: 서식 태그가 글자로 섞이던 버그) **새 코드를 배포한 뒤** 한 번 돌린다(옛 api 가 떠
있으면 다음 저장이 태그를 다시 적는다). api 가 떠 있는 채로 돌려도 된다 — 읽은 뒤 저장이 끼어든 문서는 건너뛴다
(조건부 UPDATE). `EMBED_URL` 이 있으면 평문이 바뀐 문서를 바로 다시 색인한다.
"""

import asyncio
import sys
import uuid

from pycrdt import Doc, XmlFragment
from sqlalchemy import func, select, update

from app.ai import embed
from app.db import session_scope
from app.models import Document
from app.realtime.yjs import _plain_text


async def recache(doc_id: uuid.UUID) -> bool:
    """스냅샷에서 평문을 다시 뽑아 text_cache 가 다르면 text_cache·tsv 를 적는다. 바꿨으면 True."""
    async with session_scope() as db:
        row = (
            await db.execute(
                select(Document.ydoc_snapshot, Document.text_cache).where(
                    Document.id == doc_id, Document.deleted_at.is_(None)
                )
            )
        ).first()
        if row is None or not row[0]:
            return False
        doc = Doc(skip_gc=True)
        doc.apply_update(row[0])
        text = _plain_text(doc.get("default", type=XmlFragment))
        if text == row[1]:
            return False
        # 읽은 뒤 save_room 이 먼저 적었거나 휴지통으로 갔으면 건드리지 않는다 — 옛 평문으로 새 저장을 덮지 않게
        result = await db.execute(
            update(Document)
            .where(
                Document.id == doc_id,
                Document.text_cache.is_not_distinct_from(row[1]),
                Document.deleted_at.is_(None),
            )
            .values(
                text_cache=text,
                tsv=func.to_tsvector("simple", text.encode()[:900_000].decode(errors="ignore")),
            )
        )
        await db.commit()
        if result.rowcount == 0:
            return False
    if embed.enabled():
        await embed.reindex(doc_id)
    return True


async def main() -> None:
    async with session_scope() as db:
        ids = list(await db.scalars(select(Document.id).where(Document.deleted_at.is_(None))))
    changed = failed = 0
    for i, doc_id in enumerate(ids, start=1):
        try:
            if await recache(doc_id):
                changed += 1
                print(f"[{i}/{len(ids)}] {doc_id} 평문 갱신")
        except Exception as e:  # noqa: BLE001 — 한 문서가 막혀도 나머지는 계속
            failed += 1
            print(f"[{i}/{len(ids)}] {doc_id} 실패: {e!r}", file=sys.stderr)
    print(f"문서 {len(ids)}건, 갱신 {changed}건, 실패 {failed}건")


if __name__ == "__main__":
    asyncio.run(main())
