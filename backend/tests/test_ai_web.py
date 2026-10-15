"""팩트체커 웹 검색 `web: true` (README 49)."""

import hashlib
import json
from collections.abc import AsyncIterator

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.ai.provider import ToolCalls
from app.config import Settings, settings
from app.models import AuditEvent
from app.routers import ai

from .conftest import Users, login
from .test_ai import SearchingProvider, _knowledge, share_scope
from .test_ai_check import _check
from .test_ai_rules import _reset, _rules_folder

MOEL = "https://www.moel.go.kr/news/notice.do?id=1"
TEXT = "연차 15일, 최저임금"


def _reply(**extra_claims) -> str:
    base = [
        {
            "claim": "연차 15일",
            "span": "연차 15일",
            "verdict": "match",
            "note": "제31조",
            "refs": [3],
        },
        {
            "claim": "2026년 최저임금",
            "span": "최저임금",
            "verdict": "match",
            "note": "고시",
            "refs": [],
            "url": MOEL,
            "source": "고용노동부",
        },
        {
            "claim": "지어낸 출처",
            "span": "x",
            "verdict": "match",
            "note": "",
            "refs": [],
            "url": "https://made.up/page",
        },
        {
            "claim": "위장 주소",
            "span": "x",
            "verdict": "match",
            "note": "",
            "refs": [],
            "url": "https://www.moel.go.kr@evil.com/x",
        },
        {
            "claim": "내부망",
            "span": "x",
            "verdict": "match",
            "note": "",
            "refs": [],
            "url": "http://192.168.219.8:5180/admin",
        },
        {
            "claim": "스킴",
            "span": "x",
            "verdict": "match",
            "note": "",
            "refs": [],
            "url": "javascript:alert(1)",
        },
    ]
    return json.dumps(base, ensure_ascii=False)


class Webby(SearchingProvider):
    """도구 호출 없이 JSON — 다만 「검색이 돌려준 URL」 목록을 ToolCalls(calls 없음)로 먼저 낸다(실제 공급자와 같은 모양)."""

    tools_seen: list = []
    seen_urls = [
        MOEL,
        "https://www.moel.go.kr@evil.com/x",
        "http://192.168.219.8:5180/admin",
        "javascript:alert(1)",
    ]

    async def stream(
        self, *, system, messages, max_tokens=None, tools=None, tool_choice=None
    ) -> AsyncIterator:
        SearchingProvider.systems.append(system)
        SearchingProvider.turns.append(messages)
        Webby.tools_seen.append(tools)
        yield _reply()
        if tools and any(t.get("name") == "web_search" for t in tools):
            yield ToolCalls(
                calls=[],
                content=[{"type": "text", "text": _reply()}],
                web_urls=list(self.seen_urls),
            )


async def test_web_off_by_default_and_switch_required(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Webby)
    Webby.tools_seen = []
    share_scope(monkeypatch, app_db)
    await _rules_folder(app_db, users, monkeypatch)
    ai._check_calls.clear()
    await login(client, "sujin@zenith.co.kr")
    assert (
        Settings.model_fields["ai_web_search"].default is False
    )  # 배포 기본값(conftest 가 .env 를 가린다)
    status, out = await _check(client, text=TEXT, web=True)
    assert status == 422 and out["detail"] == "웹 검색이 꺼져 있습니다."
    status, out = await _check(client, text=TEXT)  # web 없음 — 웹 도구도, 웹 카드도 없다
    assert status == 200, out
    assert Webby.tools_seen[-1] == [ai.SEARCH_TOOL, ai.READ_TOOL]
    assert ai.CHECK_WEB_PROMPT not in SearchingProvider.systems[-1][-1]["text"]
    assert (
        out["claims"][1]["verdict"] == "unverified" and out["claims"][1]["citations"] == []
    )  # url 은 버린다
    assert await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.web_search")) is None
    ai._check_calls.clear()


async def test_web_on_adds_tool_prompt_cards_and_audit(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    _reset(app, Webby)
    Webby.tools_seen = []
    share_scope(monkeypatch, app_db)
    await _rules_folder(app_db, users, monkeypatch)
    monkeypatch.setattr(settings, "ai_web_search", True)
    ai._check_calls.clear()
    await login(client, "sujin@zenith.co.kr")
    status, out = await _check(client, text=TEXT, web=True)
    assert status == 200, out
    assert Webby.tools_seen[-1] == [ai.SEARCH_TOOL, ai.WEB_TOOL]  # 웹이 켜지면 read_document 는 없다(README 54)
    assert SearchingProvider.systems[-1][-1]["text"].endswith(ai.CHECK_WEB_PROMPT)
    c = out["claims"]
    assert c[0]["citations"][0]["type"] == "doc"
    web = c[1]["citations"]
    assert c[1]["verdict"] == "match" and len(web) == 1
    assert web[0] == {
        "n": web[0]["n"],
        "type": "web",
        "to": MOEL,
        "doc_id": None,
        "title": "고용노동부",
        "quote": "고시",
        "path": "www.moel.go.kr",
    }
    assert web[0]["n"] > 6  # 번호표(규정 6조각) 뒤 번호
    # 검색이 안 돌려준 주소·userinfo 위장·내부망·스킴 — 전부 카드 없이 unverified
    for i in (2, 3, 4, 5):
        assert c[i]["verdict"] == "unverified" and c[i]["citations"] == [], c[i]
    ev = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.web_search"))
    assert ev is not None and ev.actor_id == users.member.id
    assert ev.detail == {"chars": len(TEXT), "sha": hashlib.sha256(TEXT.encode()).hexdigest()[:16]}
    assert ev.ip is not None
    ai._check_calls.clear()


async def test_pause_turn_continues_within_rounds(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """서버측 도구가 턴을 끊으면(pause_turn) 같은 메시지로 한 번 더 — 앞부분만 남아 AI_FORMAT 이 나지 않는다."""

    class Pausing(SearchingProvider):
        n = 0

        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            Pausing.n += 1
            if Pausing.n == 1:
                yield "확인해 보겠습니다."
                yield ToolCalls(
                    calls=[], content=[{"type": "text", "text": "확인해 보겠습니다."}], paused=True
                )
                return
            yield _reply()
            yield ToolCalls(calls=[], content=[{"type": "text", "text": _reply()}], web_urls=[MOEL])

    _reset(app, Pausing)
    share_scope(monkeypatch, app_db)
    await _knowledge(app_db, users)
    monkeypatch.setattr(settings, "ai_web_search", True)
    ai._check_calls.clear()
    await login(client, "sujin@zenith.co.kr")
    status, out = await _check(client, text=TEXT, web=True)
    assert status == 200, out
    assert (
        Pausing.n == 2 and SearchingProvider.turns[1][-1]["role"] == "assistant"
    )  # 끊긴 턴을 붙여 다시 불렀다
    assert out["claims"][1]["citations"][0]["to"] == MOEL
    ai._check_calls.clear()


def test_safe_web_host_rules() -> None:
    seen = {
        "https://example.com/a?x=1",
        "https://user:pw@example.com/",
        "https://example.com@evil.com/",
        "http://10.0.0.1/",
        "http://localhost/",
        "https://zenith.tail5b30d6.ts.net/x",
        "https://ｅｘａｍｐｌｅ.com/",
        "https://nodots/",
        "ftp://example.com/",
        "https://a.co/" + "x" * 2000,
    }
    assert ai._safe_web_host("https://example.com/a?x=1", seen) == "example.com"
    for bad in sorted(seen - {"https://example.com/a?x=1"}):
        assert ai._safe_web_host(bad, seen) is None, bad
    assert ai._safe_web_host("https://not-returned.com/", seen) is None  # 검색이 안 돌려준 주소
    c = ai._web_citation(9, "https://example.com/a", "example.com", "x" * 300, "설명")
    assert len(c.title) == 100 and c.quote == "설명" and c.path == "example.com"
