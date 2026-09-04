"""04-API §7 ⌘K 통합검색. FTS(tsv) + 최근성 랭킹, 권한 필터는 서버가 건다."""

from fastapi import APIRouter, Depends

from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["search"], dependencies=[Depends(current_user)])

register_stubs(
    router,
    [("GET", "/search", "?q=&types=doc,chat,post → [{type, id, title, sub, snippet, to}]")],
)
