"""04-API §7 /search — FR-SHL-02 · TC-CHT-05(문서·채팅 통합, 스니펫) · TC-CHT-06(member 로 임원 글 미노출) · TC-SEC-04."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, inspect, select, update

from app.models import (
    Board,
    Channel,
    ChannelMember,
    Document,
    Folder,
    Message,
    Post,
    Workspace,
)

from .conftest import Users, login


async def _seed(app_db, users: Users) -> dict:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    now = datetime.now(UTC)

    def doc(title: str, text: str, **kw) -> Document:
        return Document(
            folder_id=root.id,
            title=title,
            text_cache=text,
            tsv=func.to_tsvector("simple", text),
            updated_by=users.member.id,
            **kw,
        )

    docs = [
        doc("2026 로드맵", "상반기 로드맵을 정리한다. <svg onload=alert(1)> 도 그냥 글자다."),
        doc("휴지통 문서", "로드맵 이야기지만 지워졌다", deleted_at=now),
        doc("오래된 메모", "로드맵 초안", updated_at=now - timedelta(days=60)),
        doc("제목만 일치", "본문에는 다른 말", updated_at=now),
    ]
    docs[3].title = "로드맵 제목"
    general = Channel(ws_id=ws.id, name="일반", is_dm=False)
    secret = Channel(ws_id=ws.id, name="임원방", is_dm=False)
    dm = Channel(ws_id=ws.id, name="", is_dm=True)
    notice = Board(name="전체공지", min_role="member")
    lead_board = Board(name="팀장 회의록", min_role="lead")
    exec_board = Board(name="경영 보고", min_role="exec")
    odd_board = Board(name="이상한 등급", min_role="admin")  # 모르는 등급은 아무도 못 본다
    app_db.add_all(docs + [general, secret, dm, notice, lead_board, exec_board, odd_board])
    await app_db.flush()
    app_db.add_all(
        [
            ChannelMember(channel_id=general.id, user_id=users.member.id),
            ChannelMember(channel_id=general.id, user_id=users.lead.id),
            ChannelMember(channel_id=secret.id, user_id=users.exec.id),
            ChannelMember(channel_id=dm.id, user_id=users.member.id),
            ChannelMember(channel_id=dm.id, user_id=users.exec.id),
            Message(channel_id=general.id, author_id=users.lead.id, body="로드맵 회의는 내일"),
            Message(channel_id=secret.id, author_id=users.exec.id, body="로드맵 예산은 비밀"),
            Message(channel_id=dm.id, author_id=users.exec.id, body="로드맵 봐 주세요"),
            Post(
                board_id=notice.id,
                title="전사 로드맵 공유",
                body="모두 읽어 주세요",
                author_id=users.exec.id,
            ),
            Post(
                board_id=exec_board.id,
                title="임원 전용",
                body="로드맵 인수 계획",
                author_id=users.exec.id,
            ),
            Post(
                board_id=lead_board.id, title="팀장 로드맵", body="팀장만", author_id=users.lead.id
            ),
            Post(
                board_id=odd_board.id,
                title="로드맵 유령",
                body="등급 admin",
                author_id=users.exec.id,
            ),
        ]
    )
    await app_db.flush()
    return {
        "docs": docs,
        "general": general,
        "secret": secret,
        "dm": dm,
        "notice": notice,
        "exec_board": exec_board,
    }


async def test_member_search_filters_by_permission(
    client: AsyncClient, users: Users, app_db
) -> None:
    """TC-CHT-05·06: 세 타입이 섞여 오고, 남의 채널·임원 게시판·휴지통 문서는 결과에 없다. 조사 붙은 한국어도 접두로 잡는다."""
    s = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/search", params={"q": "로드맵"})
    assert r.status_code == 200, r.text
    hits = r.json()
    by_type = {}
    for h in hits:
        by_type.setdefault(h["type"], []).append(h)
    assert {h["title"] for h in by_type["doc"]} == {"2026 로드맵", "오래된 메모", "로드맵 제목"}
    assert {h["snippet"] for h in by_type["chat"]} == {
        "**로드맵** 회의는 내일",
        "**로드맵** 봐 주세요",
    }
    assert [h["title"] for h in by_type["post"]] == [
        "전사 로드맵 공유"
    ]  # 임원 글은 없다 (TC-CHT-06)
    top_doc = by_type["doc"][0]
    assert top_doc["title"] == "2026 로드맵" and top_doc["to"] == f"/docs/{s['docs'][0].id}"
    assert top_doc["sub"] == "회사 위키" and "**로드맵을**" in top_doc["snippet"]
    # TC-SEC-04: ts_headline 이 남긴 태그 조각은 이스케이프돼 나간다 — 강조는 ** 마커뿐
    assert "<" not in top_doc["snippet"] and "&lt;svg onload=alert" in top_doc["snippet"]
    title_only = next(h for h in by_type["doc"] if h["title"] == "로드맵 제목")
    assert title_only["snippet"] == "본문에는 다른 말"  # 제목만 맞으면 본문 앞부분, 강조 없음
    dm_hit = next(h for h in by_type["chat"] if h["sub"].startswith("DM"))
    assert dm_hit["sub"] == "DM · 최재호" and dm_hit["title"] == "최재호"
    assert dm_hit["to"].startswith(f"/chat/{s['dm'].id}?m=")
    assert by_type["post"][0]["to"] == f"/board/{s['notice'].id}/{by_type['post'][0]['id']}"
    assert [h["title"] for h in by_type["doc"]].index("오래된 메모") == 2  # 두 달 전 것은 뒤로

    r = await client.get("/api/search", params={"q": "로드맵", "types": "post"})
    assert {h["type"] for h in r.json()} == {"post"}
    r = await client.get("/api/search", params={"q": "로드맵 예산"})
    assert r.json() == []  # AND — 예산은 못 보는 방에만 있다
    r = await client.get("/api/search", params={"q": "& | ! ( ) : *"})
    assert r.json() == []  # 연산자만 있으면 빈 결과, 500 아님
    r = await client.get("/api/search", params={"q": "\x00 로드맵"})
    assert r.status_code == 200 and r.json()  # NUL 은 지워지고 나머지로 검색
    r = await client.get("/api/search", params={"q": "\x00"})
    assert r.json() == []
    r = await client.get("/api/search", params={"q": "로드맵,회의-내일"})  # 구두점은 그냥 AND
    assert [h["snippet"] for h in r.json()] == ["**로드맵** **회의는** **내일**"]
    for bad in ("docs", "", ",,"):
        r = await client.get("/api/search", params={"q": "로드맵", "types": bad})
        assert r.status_code == 422, bad
    r = await client.get("/api/search", params={"q": ""})
    assert r.status_code == 422


async def test_exec_sees_everything_they_may(client: AsyncClient, users: Users, app_db) -> None:
    """임원은 임원 게시판·자기 채널을 본다. 그래도 멤버 아닌 채널(일반)의 메시지는 못 본다 — 등급이 아니라 멤버십."""
    await _seed(app_db, users)
    await login(client, "jaeho@zenith.co.kr")
    r = await client.get("/api/search", params={"q": "로드맵", "limit": 50})
    hits = r.json()
    assert {h["title"] for h in hits if h["type"] == "post"} == {
        "전사 로드맵 공유",
        "임원 전용",
        "팀장 로드맵",
    }  # "로드맵 유령"(min_role=admin) 은 임원도 못 본다 — 모르는 등급은 닫힌다
    assert {h["snippet"] for h in hits if h["type"] == "chat"} == {
        "**로드맵** 예산은 비밀",
        "**로드맵** 봐 주세요",
    }
    r = await client.get("/api/search", params={"q": "로드맵", "limit": 2})
    assert len(r.json()) == 2


async def test_lead_boundary(client: AsyncClient, users: Users, app_db) -> None:
    """lead 는 member·lead 게시판까지 — exec 게시판은 안 보인다(등급 경계 <=)."""
    await _seed(app_db, users)
    await login(client, "donghyun@zenith.co.kr")
    r = await client.get("/api/search", params={"q": "로드맵", "types": "post", "limit": 50})
    assert {h["title"] for h in r.json()} == {"전사 로드맵 공유", "팀장 로드맵"}


async def test_tsv_is_generated_by_the_db(client: AsyncClient, users: Users, app_db) -> None:
    """messages·posts 의 tsv 는 DB 생성 컬럼이다 — 앱이 손으로 유지하지 않아도 본문을 따라가고(앞 절반: 즉석 계산이던
    때도 통과하던 계약), 행을 읽거나 만들 때 tsvector 가 오가지 않는다(뒤 절반: 이 변경의 회귀 가드)."""
    seeded = await _seed(app_db, users)
    await login(client, "donghyun@zenith.co.kr")

    async def chat_hits(q: str) -> int:
        return len((await client.get("/api/search", params={"q": q, "types": "chat"})).json())

    assert (await chat_hits("로드맵"), await chat_hits("결산")) == (1, 0)
    await app_db.execute(  # 본문이 바뀌면 색인도 따라간다(ORM 을 거치지 않은 UPDATE 도)
        update(Message)
        .where(Message.channel_id == seeded["general"].id)
        .values(body="분기 결산 회의")
    )
    assert (await chat_hits("로드맵"), await chat_hits("결산")) == (0, 1)

    message_id = await app_db.scalar(select(Message.id).limit(1))
    loaded = await app_db.get(Message, message_id, populate_existing=True)
    assert "tsv" in inspect(loaded).unloaded  # 메시지를 읽을 때마다 tsvector 가 오가면 안 된다

    # 만들 때도 마찬가지 — eager_defaults 가 켜져 있으면 INSERT 의 RETURNING 에 딸려 와 loaded 가 된다
    post = Post(board_id=seeded["notice"].id, title="새 글", body="본문", author_id=users.exec.id)
    message = Message(channel_id=seeded["general"].id, author_id=users.lead.id, body="새 메시지")
    app_db.add_all([post, message])
    await app_db.flush()
    assert "tsv" in inspect(post).unloaded and "tsv" in inspect(message).unloaded
    assert post.id is not None and message.id is not None  # id 는 여전히 돌아온다
