"""문서 파일 업로드(README "설계와 어긋나는 것" 16) — 프론트 useFileUpload.ts 계약: POST /files → {id, url, name, size, content_type}.

실제 MinIO 위에서 돈다 — 붙을 수 없으면 skip(conftest.minio_bucket).
"""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from httpx import AsyncClient
from sqlalchemy import select

from app import audit
from app.models import StoredFile
from app.routers.files import DAILY_UPLOADS, MAX_FILE_BYTES

from .conftest import Users, csrf, login

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 16


async def _upload(client: AsyncClient, name: str, data: bytes, content_type: str, **form):
    return await client.post(
        "/api/files", files={"file": (name, data, content_type)}, data=form, headers=csrf(client)
    )


async def test_upload_then_img_src_download(
    client: AsyncClient, users: Users, app_db, minio_bucket, make_client
) -> None:
    # 로그인·CSRF 문 — 라우터 의존성이 빠지면 여기서 깨진다
    assert (await _upload(client, "a.png", PNG, "image/png")).status_code == 401
    await login(client, "sujin@zenith.co.kr")
    r = await client.post("/api/files", files={"file": ("a.png", PNG, "image/png")})
    assert (r.status_code, r.json()["code"]) == (403, "CSRF_TOKEN")

    since = datetime.now(UTC) - timedelta(minutes=1)
    r = await _upload(client, "../사진.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"id", "url", "name", "size", "content_type"}
    assert (body["url"], body["name"], body["size"], body["content_type"]) == (
        f"/api/files/{body['id']}",
        "_사진.png",  # 경로 문자는 _, 앞뒤 점은 벗긴다(storage.safe_name)
        len(PNG),
        "image/png",
    )
    assert await audit.count_since(app_db, "files.uploaded", since, actor=str(users.member.id)) == 1
    row = await app_db.get(StoredFile, body["id"])  # 기록부 — 자료실(#226)이 읽는다
    assert (row.name, row.size, row.content_type, row.uploader_id, row.doc_id) == (
        "_사진.png",
        len(PNG),
        "image/png",
        users.member.id,
        None,
    )

    r = await client.get(body["url"])  # 브라우저 <img src> — 쿠키만 붙는다
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["content-disposition"] == "inline"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "default-src 'none'; sandbox"
    # no-cache + ETag(#328) — 열 때마다 쿠키로 재검증, 같은 파일이면 304 로 MinIO 를 안 탄다
    assert r.headers["cache-control"] == "private, no-cache"
    assert r.headers["etag"] == f'"{body["id"]}"'
    r304 = await client.get(body["url"], headers={"If-None-Match": r.headers["etag"]})
    assert r304.status_code == 304 and r304.content == b""
    assert (
        r304.headers["content-security-policy"] == "default-src 'none'; sandbox"
    )  # 304 도 같은 보안 헤더
    assert (await client.get(body["url"], headers={"If-None-Match": '"x"'})).status_code == 200

    # 다른 사용자도 읽는다(문서에 열람 등급 없음) — 로그인 없이는 401
    other = make_client()
    async with other:
        await login(other, "donghyun@zenith.co.kr")
        assert (await other.get(body["url"])).status_code == 200
    anon = make_client()
    async with anon:
        assert (await anon.get(body["url"])).status_code == 401
        # 304 도 인증 뒤 — 로그인 없이 ETag 를 들고 와도 401(304 로 캐시를 살려 주지 않는다)
        r = await anon.get(body["url"], headers={"If-None-Match": f'"{body["id"]}"'})
        assert r.status_code == 401
    assert (await client.get("/api/files/00000000-0000-0000-0000-000000000000")).status_code == 404


async def test_non_image_files_download_as_attachment(
    client: AsyncClient, users: Users, app_db, minio_bucket
) -> None:
    """그림이 아닌 파일(#224): 받되 inline 으로는 절대 내주지 않는다. 형식은 우긴 헤더가 아니라 octet-stream."""
    await login(client, "sujin@zenith.co.kr")
    # 헤더는 image/png 라고 우기지만 바이트는 HTML — 매직 바이트에 안 걸리니 octet-stream + attachment
    r = await _upload(client, "x.png", b"<html><script>alert(1)</script>", "image/png")
    assert r.status_code == 201, r.text
    assert r.json()["content_type"] == "application/octet-stream"
    r = await client.get(r.json()["url"])
    assert r.status_code == 200 and r.content.startswith(b"<html>")
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"] == "attachment; filename*=UTF-8''x.png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "default-src 'none'; sandbox"
    # svg·pdf·매직 근접 실패(RIFF 이지만 WEBP 가 아님, GIF8 로 끝남) 도 전부 attachment, 한글 이름은 filename*
    for name, data, claimed in (
        ("도형.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml"),
        ("보고서.pdf", b"%PDF-1.7 ...", "application/pdf"),
        ("a.wav", b"RIFF\x10\x00\x00\x00WAVEfmt ", "image/webp"),
        ("a.gif", b"GIF8", "image/gif"),
    ):
        r = await _upload(client, name, data, claimed)
        assert r.status_code == 201, (name, r.text)
        assert r.json()["content_type"] == "application/octet-stream"
        d = await client.get(r.json()["url"])
        assert d.headers["content-type"] == "application/octet-stream"
        assert d.headers["content-disposition"] == (
            f"attachment; filename*=UTF-8''{quote(name, safe='')}"
        )
    assert (
        await audit.count_since(
            app_db,
            "files.uploaded",
            datetime.now(UTC) - timedelta(minutes=1),
            actor=str(users.member.id),
        )
        == 5
    )


async def test_doc_id_is_recorded(client: AsyncClient, users: Users, app_db, minio_bucket) -> None:
    """프론트가 폼에 보내는 doc_id 는 기록부에 남는다. 없는 문서면 422."""
    from app.models import Document, Folder, Workspace

    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    folder = Folder(ws_id=ws.id, parent_id=None, title="루트")
    app_db.add(folder)
    await app_db.flush()
    doc = Document(folder_id=folder.id, title="실사 메모", updated_by=users.member.id)
    app_db.add(doc)
    await app_db.flush()
    await login(client, "sujin@zenith.co.kr")
    r = await _upload(client, "보고서.pdf", b"%PDF-1.7", "application/pdf", doc_id=str(doc.id))
    assert r.status_code == 201, r.text
    assert (await app_db.get(StoredFile, r.json()["id"])).doc_id == doc.id
    r = await _upload(client, "a.pdf", b"%PDF", "application/pdf", doc_id=str(uuid.uuid4()))
    assert (r.status_code, r.json()["detail"]) == (422, "없는 문서입니다.")
    doc.deleted_at = datetime.now(UTC)  # 휴지통 문서도 같은 답
    await app_db.flush()
    r = await _upload(client, "a.pdf", b"%PDF", "application/pdf", doc_id=str(doc.id))
    assert (r.status_code, r.json()["detail"]) == (422, "없는 문서입니다.")
    r = await _upload(client, "a.pdf", b"%PDF", "application/pdf", doc_id="not-a-uuid")
    assert r.status_code == 422
    assert len((await app_db.execute(select(StoredFile))).scalars().all()) == 1  # 거절은 행도 없다


async def test_upload_rejects_empty_and_oversize(
    client: AsyncClient, users: Users, app_db, minio_bucket
) -> None:
    await login(client, "sujin@zenith.co.kr")
    r = await _upload(client, "empty.png", b"", "image/png")
    assert (r.status_code, r.json()["detail"]) == (422, "빈 파일입니다.")
    # 10MB 정확히는 되고, 1바이트 넘으면 422
    exact = PNG + b"\x00" * (MAX_FILE_BYTES - len(PNG))
    assert (await _upload(client, "exact.png", exact, "image/png")).status_code == 201
    assert (await _upload(client, "big.png", exact + b"\x00", "image/png")).status_code == 422
    # webp 는 RIFF….WEBP — content type 은 헤더가 아니라 바이트에서
    r = await _upload(client, "w.bin", WEBP, "application/octet-stream")
    assert r.status_code == 201
    assert (await client.get(r.json()["url"])).headers["content-type"] == "image/webp"


async def test_daily_upload_cap(client: AsyncClient, users: Users, app_db, minio_bucket) -> None:
    """하루 DAILY_UPLOADS 장 — 감사 로그를 세어 판정하므로 행을 직접 심어 상한을 만든다."""
    await login(client, "sujin@zenith.co.kr")
    for _ in range(DAILY_UPLOADS):
        audit.record(
            app_db,
            "files.uploaded",
            actor_id=users.member.id,
            detail={"actor": str(users.member.id)},
        )
    await app_db.flush()
    r = await _upload(client, "a.png", PNG, "image/png")
    assert (r.status_code, r.json()["code"]) == (429, "UPLOAD_THROTTLED")
    # 다른 사람은 무관
    await login(client, "donghyun@zenith.co.kr")
    assert (await _upload(client, "a.png", PNG, "image/png")).status_code == 201


async def test_legacy_image_without_registry_row_is_inline(
    client: AsyncClient, users: Users, app_db, minio_bucket
) -> None:
    """2026-10-02 이전에 올린 그림은 `files` 행이 없다 — MinIO 메타데이터로 전과 같이 inline."""
    from app import storage

    legacy = uuid.uuid4()
    await storage.put(f"files/{legacy}", PNG, "image/png")
    await login(client, "sujin@zenith.co.kr")
    r = await client.get(f"/api/files/{legacy}")
    assert r.status_code == 200 and r.content == PNG
    assert (r.headers["content-type"], r.headers["content-disposition"]) == ("image/png", "inline")
    assert r.headers["x-content-type-options"] == "nosniff"
