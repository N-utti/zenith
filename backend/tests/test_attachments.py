"""04-API §5 채팅 첨부 — FR-CHT-04(10MB · 이미지 인라인) · TC-CHT-04(초과 422) · TC-AUTH-04(남의 채널 403).

실제 MinIO(compose 의 minio) 위에서 돈다 — 붙을 수 없으면 DB 테스트와 같이 skip. CI 는 minio 컨테이너를 띄운다.
"""

import os
import socket
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import select

from app import storage
from app.config import settings
from app.models import AuditEvent, Message

from .conftest import Users, csrf, login
from .test_ws import WS, make_channel, recv_until, send, ws_client

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def minio_bucket(monkeypatch) -> Iterator[str]:
    """테스트 전용 버킷 — 끝나면 이 테스트가 만든 오브젝트를 지운다."""
    host, _, port = settings.minio_endpoint.partition(":")
    try:
        socket.create_connection((host, int(port or 9000)), timeout=1).close()
    except OSError as e:
        if os.getenv("CI"):
            pytest.fail(f"CI 는 MinIO 를 띄운다(ci.yml) — 붙을 수 없다: {e}")
        pytest.skip(f"MinIO 에 붙을 수 없어 첨부 테스트를 건너뛴다: {e}")
    bucket = "zenith-test"
    monkeypatch.setattr(settings, "minio_bucket", bucket)
    storage._ensured.discard(bucket)
    storage._client.cache_clear()
    yield bucket
    client = storage._client()
    if client.bucket_exists(bucket):
        for obj in list(client.list_objects(bucket, recursive=True)):
            client.remove_object(bucket, obj.object_name)


@pytest.fixture(autouse=True)
def _chat_uses_test_session(app, app_db, monkeypatch):
    from app.realtime import chat as mod

    from .conftest import share_session

    share_session(app, app_db, monkeypatch, mod)
    yield
    mod.SOCKETS.clear()


async def _upload(client: AsyncClient, channel_id, name: str, data: bytes, content_type: str):
    return await client.post(
        f"/api/channels/{channel_id}/attachments",
        files={"file": (name, data, content_type)},
        headers=csrf(client),
    )


async def test_upload_and_download(
    app: FastAPI, client: AsyncClient, users: Users, app_db, minio_bucket
) -> None:
    """올리면 {url, name, size}, 그 url 로 멤버가 내려받는다. 이미지는 inline, 문서는 attachment + nosniff."""
    channel = await make_channel(app_db, [users.member, users.lead])
    await login(client, "sujin@zenith.co.kr")
    r = await _upload(client, channel.id, "회의 사진.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "회의 사진.png" and body["size"] == len(PNG)
    assert body["url"].startswith(f"/api/channels/{channel.id}/attachments/")

    got = await client.get(body["url"])
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert got.headers["content-disposition"].startswith("inline; filename*=UTF-8''")
    assert got.headers["x-content-type-options"] == "nosniff"

    # 브라우저에서 스크립트가 돌 수 있는 형식은 inline 이 아니다 — 같은 오리진 XSS
    r = await _upload(client, channel.id, "evil.svg", b"<svg onload=alert(1)/>", "image/svg+xml")
    got = await client.get(r.json()["url"])
    assert got.headers["content-disposition"].startswith("attachment;")

    # 경로 문자는 벗긴다 — 키·Content-Disposition 에 그대로 들어간다
    r = await _upload(client, channel.id, "../../etc/passwd", b"x", "text/plain")
    assert (
        r.json()["name"] == "_.._etc_passwd"
    )  # 구분자만 바꾼다 — 키가 다른 채널 경로로 못 빠져나간다

    # 없는 파일은 404, 존재를 아는 멤버에게만. 이름 변형(`..`)은 별칭이 아니다 — 발급된 URL 만 통한다
    missing = f"/api/channels/{channel.id}/attachments/{uuid.uuid4()}/x.txt"
    assert (await client.get(missing)).status_code == 404
    assert (
        await client.get(
            body["url"].replace("attachments/", "attachments/", 1).rsplit("/", 1)[0]
            + "/..%ED%9A%8C%EC%9D%98%20%EC%82%AC%EC%A7%84.png"
        )
    ).status_code == 404
    # 같은 file_id·name 을 다른 채널 경로로 — 키에 채널 id 가 있어 404 (크로스 채널 격리는 키 수준)
    other = await make_channel(app_db, [users.member], name="다른")
    assert (
        await client.get(body["url"].replace(str(channel.id), str(other.id)))
    ).status_code == 404

    # content_type 은 선언값 기준(매직바이트 안 본다) — HTML 을 image/png 로 올려도 image/png + nosniff 로만 나간다
    r = await _upload(client, channel.id, "fake.png", b"<script>1</script>", "image/png")
    got = await client.get(r.json()["url"])
    assert (
        got.headers["content-type"] == "image/png"
        and got.headers["x-content-type-options"] == "nosniff"
    )
    r = await _upload(
        client, channel.id, "weird.bin", b"x", "not a type"
    )  # 깨진 헤더 값은 octet-stream
    assert (await client.get(r.json()["url"])).headers["content-type"] == "application/octet-stream"


async def test_limits(client: AsyncClient, users: Users, app_db, minio_bucket) -> None:
    """TC-CHT-04: 10MB 초과 422 + 안내. 빈 파일도 422. 긴 한글 이름도 된다(URL 은 글자당 9자)."""
    channel = await make_channel(app_db, [users.member])
    # 로그인 전에도 거대한 본문은 라우팅 전에 끊긴다 — 인증 전에 디스크를 채우지 못하게(main.py body_limit)
    r = await client.post(
        f"/api/channels/{channel.id}/attachments",
        content=b"0" * (13 * 1024 * 1024),
        headers={"content-type": "multipart/form-data; boundary=x"},
    )
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION"
    # 로그인 없이 401, CSRF 헤더 없이 403 — 업로드도 다른 상태 변경 요청과 같은 문
    r = await client.post(f"/api/channels/{channel.id}/attachments", files={"file": ("a", b"x")})
    assert r.status_code == 401
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(f"/api/channels/{channel.id}/attachments", files={"file": ("a", b"x")})
    assert r.status_code == 403 and r.json()["code"] == "CSRF_TOKEN"
    long_name = "가" * 200 + ".png"
    r = await _upload(client, channel.id, long_name, PNG, "image/png")
    assert r.status_code == 201 and len(r.json()["name"].encode()) <= 200  # MinIO 경로 조각 255B
    assert (await client.get(r.json()["url"])).status_code == 200
    r = await _upload(client, channel.id, "big.bin", b"0" * (10 * 1024 * 1024 + 1), "text/plain")
    assert r.status_code == 422 and "10MB" in r.json()["detail"]
    r = await _upload(client, channel.id, "empty.bin", b"", "text/plain")
    assert r.status_code == 422
    r = await _upload(client, channel.id, "exact.bin", b"0" * (10 * 1024 * 1024), "text/plain")
    assert r.status_code == 201


async def test_non_member_is_refused_and_audited(
    client: AsyncClient, make_client, users: Users, app_db, minio_bucket
) -> None:
    """TC-AUTH-04: 남의 채널에는 올리지도 내려받지도 못한다 — 403 + acl.denied(REST 와 같은 판정)."""
    channel = await make_channel(app_db, [users.member])
    await login(client, "sujin@zenith.co.kr")
    url = (await _upload(client, channel.id, "a.txt", b"hello", "text/plain")).json()["url"]

    async with make_client() as other:
        await login(other, "donghyun@zenith.co.kr")
        r = await _upload(other, channel.id, "b.txt", b"x", "text/plain")
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
        assert (await other.get(url)).status_code == 403
        r = await _upload(other, uuid.uuid4(), "b.txt", b"x", "text/plain")  # 없는 채널도 같은 403
        assert r.status_code == 403
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 3 and {d.actor_id for d in denied} == {users.lead.id}
    assert {d.target_id for d in denied} >= {channel.id}


async def test_message_with_attachments(app: FastAPI, users: Users, app_db, minio_bucket) -> None:
    """업로드 응답을 msg op 에 그대로 실으면 저장·방송되고 과거 메시지 조회에도 남는다. 본문 없이 첨부만도 된다.
    남의 채널 URL 은 VALIDATION."""
    mine = await make_channel(app_db, [users.member, users.lead])
    theirs = await make_channel(app_db, [users.member], name="혼자")
    async with ws_client(app) as a, ws_client(app) as b:
        await login(a, "sujin@zenith.co.kr")
        await login(b, "donghyun@zenith.co.kr")
        att = (await _upload(a, mine.id, "사진.png", PNG, "image/png")).json()
        foreign = (await _upload(a, theirs.id, "x.txt", b"x", "text/plain")).json()
        async with aconnect_ws(WS, a) as a_ws, aconnect_ws(WS, b) as b_ws:
            await send(a_ws, op="msg", channel_id=str(mine.id), attachments=[att])
            got = await recv_until(b_ws, "msg")
            assert got["message"]["body"] == "" and got["message"]["attachments"] == [att]
            # 내려받기는 멤버인 b 도 된다
            assert (await b.get(att["url"])).content == PNG

            await send(a_ws, op="msg", channel_id=str(mine.id), body="x", attachments=[foreign])
            # a 는 자기 msg·unread·presence 도 받는다 — error 만 골라 본다
            assert (await recv_until(a_ws, "error"))["code"] == "VALIDATION"
            await send(a_ws, op="msg", channel_id=str(mine.id))  # 본문도 첨부도 없음
            assert (await recv_until(a_ws, "error"))["code"] == "VALIDATION"
            await send(
                a_ws,
                op="msg",
                channel_id=str(mine.id),
                attachments=[{**att, "url": "/api/channels/x/attachments/y/z"}],
            )
            assert (await recv_until(a_ws, "error"))["code"] == "VALIDATION"
            await send(a_ws, op="msg", channel_id=str(mine.id), attachments=[att] * 11)  # 상한 10
            assert (await recv_until(a_ws, "error"))["code"] == "VALIDATION"
            # 표시 이름을 바꿔치기 못 한다 — report.png 를 "연봉계약서.pdf" 로
            await send(
                a_ws, op="msg", channel_id=str(mine.id), attachments=[{**att, "name": "연봉.pdf"}]
            )
            assert (await recv_until(a_ws, "error"))["code"] == "VALIDATION"

        page = (await b.get(f"/api/channels/{mine.id}/messages")).json()
        assert [m["attachments"] for m in page["items"]] == [[att]]
    rows = (await app_db.execute(select(Message))).scalars().all()
    assert len(rows) == 1 and rows[0].attachments == [att]


async def test_storage_down_is_503(client: AsyncClient, users: Users, app_db, monkeypatch) -> None:
    """MinIO 에 못 붙으면 스택트레이스가 아니라 503 STORAGE_UNAVAILABLE."""
    from urllib3.exceptions import MaxRetryError

    channel = await make_channel(app_db, [users.member])
    await login(client, "sujin@zenith.co.kr")

    def down(*_):
        raise MaxRetryError(None, "http://minio:9000", "connection refused")

    monkeypatch.setattr(storage, "_put_sync", down)
    r = await _upload(client, channel.id, "a.txt", b"x", "text/plain")
    assert r.status_code == 503 and r.json()["code"] == "STORAGE_UNAVAILABLE"
