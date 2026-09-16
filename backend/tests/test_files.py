"""문서 이미지 업로드(README "설계와 어긋나는 것" 16) — 프론트 useImageUpload.ts 계약: POST /files → {id, url, name, size}.

실제 MinIO 위에서 돈다 — 붙을 수 없으면 skip(conftest.minio_bucket).
"""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app import audit
from app.routers.files import DAILY_UPLOADS, MAX_IMAGE_BYTES

from .conftest import Users, csrf, login

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 16


async def _upload(client: AsyncClient, name: str, data: bytes, content_type: str):
    return await client.post(
        "/api/files", files={"file": (name, data, content_type)}, headers=csrf(client)
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
    assert set(body) == {"id", "url", "name", "size"}
    assert (body["url"], body["name"], body["size"]) == (
        f"/api/files/{body['id']}",
        "_사진.png",  # 경로 문자는 _, 앞뒤 점은 벗긴다(storage.safe_name)
        len(PNG),
    )
    assert await audit.count_since(app_db, "files.uploaded", since, actor=str(users.member.id)) == 1

    r = await client.get(body["url"])  # 브라우저 <img src> — 쿠키만 붙는다
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["content-disposition"] == "inline"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert r.headers["cache-control"] == "private, max-age=86400"

    # 다른 사용자도 읽는다(문서에 열람 등급 없음) — 로그인 없이는 401
    other = make_client()
    async with other:
        await login(other, "donghyun@zenith.co.kr")
        assert (await other.get(body["url"])).status_code == 200
    anon = make_client()
    async with anon:
        assert (await anon.get(body["url"])).status_code == 401
    assert (await client.get("/api/files/00000000-0000-0000-0000-000000000000")).status_code == 404


async def test_upload_rejects_non_images_and_oversize(
    client: AsyncClient, users: Users, app_db, minio_bucket
) -> None:
    await login(client, "sujin@zenith.co.kr")
    since = datetime.now(UTC) - timedelta(minutes=1)
    # 헤더는 image/png 라고 우기지만 바이트는 HTML — 판정은 매직 바이트, 시도는 감사에 남는다
    r = await _upload(client, "x.png", b"<html><script>alert(1)</script>", "image/png")
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    assert await audit.count_since(app_db, "files.rejected", since, claimed="image/png") == 1
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>"
    assert (await _upload(client, "a.svg", svg, "image/svg+xml")).status_code == 422
    # 매직 근접 실패 — RIFF 이지만 WEBP 가 아님, GIF8 로 끝남
    assert (
        await _upload(client, "a.wav", b"RIFF\x10\x00\x00\x00WAVEfmt ", "image/webp")
    ).status_code == 422
    assert (await _upload(client, "a.gif", b"GIF8", "image/gif")).status_code == 422
    r = await _upload(client, "empty.png", b"", "image/png")
    assert (r.status_code, r.json()["detail"]) == (422, "빈 파일입니다.")
    # 10MB 정확히는 되고, 1바이트 넘으면 422
    exact = PNG + b"\x00" * (MAX_IMAGE_BYTES - len(PNG))
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
