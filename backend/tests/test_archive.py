"""자료실 `GET /archive`(README "설계와 어긋나는 것" 23 · 이슈 #226) — 내가 받을 수 있는 파일만, 최근 순, 열람 범위 표시."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.models import Channel, ChannelMember, Document, Folder, Message, StoredFile, Workspace

from .conftest import Users, login


async def _seed(app_db, users: Users) -> dict:
    now = datetime.now(UTC)
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    general = Channel(ws_id=ws.id, name="일반", is_dm=False)
    dm = Channel(ws_id=ws.id, name="", is_dm=True)
    secret = Channel(ws_id=ws.id, name="인사", is_dm=False, is_private=True)
    others = Channel(ws_id=ws.id, name="임원", is_dm=False)  # 김수진은 멤버 아님
    folder = Folder(ws_id=ws.id, parent_id=None, title="루트")
    app_db.add_all([general, dm, secret, others, folder])
    await app_db.flush()
    app_db.add_all(
        [
            ChannelMember(channel_id=general.id, user_id=users.member.id),
            ChannelMember(channel_id=general.id, user_id=users.lead.id),
            ChannelMember(channel_id=dm.id, user_id=users.member.id),
            ChannelMember(channel_id=dm.id, user_id=users.exec.id),
            ChannelMember(channel_id=secret.id, user_id=users.member.id),
            ChannelMember(channel_id=others.id, user_id=users.exec.id),
        ]
    )
    doc = Document(folder_id=folder.id, title="실사 메모", updated_by=users.member.id)
    trashed = Document(
        folder_id=folder.id, title="지운 문서", updated_by=users.member.id, deleted_at=now
    )
    app_db.add_all([doc, trashed])
    await app_db.flush()

    def att(cid, name, size=10):
        return {
            "url": f"/api/channels/{cid}/attachments/00000000-0000-0000-0000-000000000001/{name}",
            "name": name,
            "size": size,
            "content_type": "application/octet-stream",
        }

    app_db.add_all(
        [
            Message(
                channel_id=general.id,
                author_id=users.lead.id,
                body="첨부 둘",
                attachments=[att(general.id, "a.pdf"), att(general.id, "b.xlsx", 20)],
                created_at=now - timedelta(minutes=5),
            ),
            Message(  # 첨부 없는 메시지는 안 나온다 — chat.py 처럼 None 을 명시(JSON null 로 저장), 가장 최근에
                channel_id=general.id,
                author_id=users.lead.id,
                body="글만",
                attachments=None,
                created_at=now,
            ),
            Message(
                channel_id=dm.id,
                author_id=users.exec.id,
                body="",
                attachments=[att(dm.id, "dm.png")],
                created_at=now - timedelta(minutes=3),
            ),
            Message(
                channel_id=secret.id,
                author_id=users.member.id,
                body="",
                attachments=[att(secret.id, "secret.docx")],
                created_at=now - timedelta(minutes=2),
            ),
            Message(  # 멤버 아닌 채널 — 보이면 안 된다
                channel_id=others.id,
                author_id=users.exec.id,
                body="",
                attachments=[att(others.id, "exec-only.pdf")],
                created_at=now - timedelta(minutes=1),
            ),
            StoredFile(
                name="보고서.pdf",
                size=30,
                content_type="application/octet-stream",
                uploader_id=users.lead.id,
                doc_id=doc.id,
                created_at=now - timedelta(minutes=6),
            ),
            StoredFile(  # 출처 모름(옛 그림) — 안 실린다
                name="image.png",
                size=5,
                content_type="image/png",
                uploader_id=users.member.id,
                doc_id=None,
                created_at=now,
            ),
            StoredFile(  # 휴지통 문서의 파일 — 안 실린다
                name="trash.pdf",
                size=5,
                content_type="application/octet-stream",
                uploader_id=users.member.id,
                doc_id=trashed.id,
                created_at=now,
            ),
        ]
    )
    await app_db.flush()
    return {"general": general, "dm": dm, "secret": secret, "others": others, "doc": doc}


async def test_archive_lists_only_what_viewer_can_download(
    client: AsyncClient, users: Users, app_db
) -> None:
    s = await _seed(app_db, users)
    await login(client, "sujin@zenith.co.kr")
    r = await client.get("/api/archive")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["name"] for i in items] == ["secret.docx", "dm.png", "a.pdf", "b.xlsx", "보고서.pdf"]
    secret, dm, a, b, report = items
    assert (secret["source"], secret["scope"], secret["source_title"]) == (
        "chat",
        "members",
        "인사",
    )
    assert secret["source_id"] == str(s["secret"].id)
    assert (dm["scope"], dm["source_title"], dm["uploaded_by"]["name"]) == (
        "members",
        "최재호",
        "최재호",
    )
    assert (a["scope"], a["source_title"], a["size"]) == ("all", "일반", 10)
    assert a["url"].startswith(f"/api/channels/{s['general'].id}/attachments/")
    assert b["size"] == 20 and a["created_at"] == b["created_at"]  # 같은 메시지의 첨부 둘
    assert (report["source"], report["scope"], report["source_title"]) == (
        "doc",
        "all",
        "실사 메모",
    )
    assert report["source_id"] == str(s["doc"].id) and report["uploaded_by"]["name"] == "박동현"
    assert report["url"].startswith("/api/files/")
    # 임원은 다른 채널 집합 — 자기 채널 것만
    await login(client, "jaeho@zenith.co.kr")
    names = [i["name"] for i in (await client.get("/api/archive")).json()["items"]]
    assert names == ["exec-only.pdf", "dm.png", "보고서.pdf"]
    # limit 은 1~200. 첨부 없는 최근 메시지(JSON null)가 limit 을 먹지 않는다
    await login(client, "sujin@zenith.co.kr")
    assert [i["name"] for i in (await client.get("/api/archive?limit=1")).json()["items"]] == [
        "secret.docx"
    ]
    await login(client, "jaeho@zenith.co.kr")
    r = await client.get("/api/archive?limit=2")
    assert [i["name"] for i in r.json()["items"]] == ["exec-only.pdf", "dm.png"]
    assert (await client.get("/api/archive?limit=0")).status_code == 422
    assert (await client.get("/api/archive?limit=201")).status_code == 422
