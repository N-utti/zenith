"""벡터 색인 백필(README 45) — 살아 있는 문서를 전부(기본) 또는 청크가 없는 것만(`--missing`) 다시 색인한다.

    uv run python scripts/reindex.py [--missing]

`.env` 의 `EMBED_URL` 이 있어야 한다(없으면 아무것도 안 하고 끝). Ollama 가 떠 있고 모델이 내려받아져 있어야
한다(`docker compose exec ollama ollama pull bge-m3`). api 가 떠 있는 채로 돌려도 된다 — 편집 중인 문서는
다음 저장이 다시 색인한다(embed.reindex 주석의 중복 가능성 참조).
"""

import asyncio
import sys

from sqlalchemy import exists, select

from app.ai import embed
from app.db import session_scope
from app.models import DocChunk, Document


async def main(missing_only: bool) -> None:
    if not embed.enabled():
        print("EMBED_URL 이 비어 있다 — 벡터 색인이 꺼져 있다.", file=sys.stderr)
        return
    stmt = select(Document.id).where(Document.deleted_at.is_(None)).order_by(Document.updated_at)
    if missing_only:
        stmt = stmt.where(~exists().where(DocChunk.doc_id == Document.id))
    async with session_scope() as db:
        ids = list(await db.scalars(stmt))
    total = failed = 0
    for i, doc_id in enumerate(ids, start=1):
        try:
            n = await embed.reindex(doc_id)
        except Exception as e:  # noqa: BLE001 — 한 문서가 막혀도 나머지는 계속
            failed += 1
            print(f"[{i}/{len(ids)}] {doc_id} 실패: {e!r}", file=sys.stderr)
            continue
        total += n
        print(f"[{i}/{len(ids)}] {doc_id} 청크 {n}")
    print(f"문서 {len(ids)}건, 청크 {total}개, 실패 {failed}건")
    if failed:
        print("실패분은 --missing 으로 다시 돌린다.", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main("--missing" in sys.argv[1:]))
