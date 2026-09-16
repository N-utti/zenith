"""MinIO(S3) 오브젝트 저장소 — 채팅 첨부(routers/channels.py)·문서 이미지(routers/files.py). ARCHITECTURE §7 의 minio 와 짝.

클라이언트는 동기(minio-py)라 스레드로 넘긴다. 버킷은 프로세스에서 처음 쓸 때 한 번 확인·생성한다.
브라우저는 MinIO 에 직접 붙지 않는다 — 업로드·다운로드 모두 API 를 지나고, 권한 판정은 호출한 라우터가 한다
(채널 첨부 = 멤버십, 문서 이미지 = 로그인만). 여기는 키·바이트만 안다.
MinIO 에 붙지 못하면 503 `STORAGE_UNAVAILABLE` — 스택트레이스 대신 안내 문구.
"""

import asyncio
import io
from functools import cache

from minio import Minio
from minio.error import MinioException, S3Error
from urllib3.exceptions import HTTPError

from app.config import settings
from app.errors import ApiError

_ensured: set[str] = set()  # 이 프로세스가 존재를 확인한 버킷


@cache
def _client() -> Minio:
    # ponytail: 사내망 평문(secure=False). TLS 를 MinIO 앞에 붙이면 endpoint 와 함께 설정으로 뺀다.
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )


def _ensure_bucket(c: Minio, bucket: str) -> None:
    if bucket in _ensured:
        return
    if not c.bucket_exists(bucket):
        try:
            c.make_bucket(bucket)
        except S3Error as e:  # 첫 업로드 둘이 동시에 만들면 한쪽은 이미 있다
            if e.code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
    _ensured.add(bucket)


def _put_sync(key: str, data: bytes, content_type: str) -> None:
    c = _client()
    _ensure_bucket(c, settings.minio_bucket)
    c.put_object(settings.minio_bucket, key, io.BytesIO(data), len(data), content_type=content_type)


def _get_sync(key: str) -> tuple[bytes, str] | None:
    """(본문, content_type). 없으면 None."""
    try:
        resp = _client().get_object(settings.minio_bucket, key)
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchBucket"):
            return None
        raise
    try:
        return resp.read(), resp.headers.get("Content-Type") or "application/octet-stream"
    finally:
        resp.close()
        resp.release_conn()


async def _call(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except (MinioException, HTTPError) as e:
        raise ApiError(503, "STORAGE_UNAVAILABLE", "파일 저장소에 연결할 수 없습니다.") from e


async def put(key: str, data: bytes, content_type: str) -> None:
    await _call(_put_sync, key, data, content_type)


async def get(key: str) -> tuple[bytes, str] | None:
    return await _call(_get_sync, key)


def safe_name(filename: str | None) -> str:
    """경로 구분자·제어문자를 벗기고 basename 만. 오브젝트 키와 Content-Disposition 에 그대로 쓴다."""
    name = "".join(
        c if c.isprintable() and c not in "/\\" else "_" for c in (filename or "").strip()
    ).strip(". ")
    # MinIO 는 경로 조각 하나를 파일시스템 이름(255바이트)으로 쓴다 — 글자가 아니라 바이트로 자른다
    return name.encode()[:200].decode("utf-8", "ignore").strip(". ") or "file"
