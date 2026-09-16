"""문서 이미지 업로드 — 04 에 없는 경로(README "설계와 어긋나는 것" 16). ARCHITECTURE §2 "MinIO: 문서 이미지·채팅 첨부".

프론트 편집기(frontend/src/features/docs/useImageUpload.ts)는 `POST /files` 로 올리고 본문(Y.Doc)에는 `url` 만 넣는다 —
바이너리를 Y.Doc 에 담으면 버전 스냅샷마다 복사된다. 문서에 열람 등급이 없으므로(04 §3) 로그인한 사람은 누구나
읽는다. 형식은 브라우저가 inline 으로 안전하게 그리는 네 가지만(svg 는 같은 오리진 XSS — 받지 않는다), 판정은
Content-Type 헤더가 아니라 앞 바이트로. 서버는 이미지를 디코딩하지 않는다(픽셀 폭탄 무관).
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, storage
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import User

router = APIRouter(tags=["files"])

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 프론트 useImageUpload.ts 의 MAX_IMAGE_BYTES 와 같은 값
# 사용자별 하루 상한. miniodata 가 db 와 같은 디스크라 저장소 포화는 전면 장애다 — 감사 로그를 세어 판정(별도 저장소 없음).
# ponytail: 총량(디스크) 감시와 미참조 오브젝트 정리는 없다 — 15명·200장/일이면 하루 최대 30GB 가 천장.
DAILY_UPLOADS = 200
# 매직 바이트 → content type. 헤더는 클라이언트가 정하는 값이라 믿지 않는다.
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)
ALLOWED_TYPES = frozenset(ct for _, ct in MAGIC) | {
    "image/webp"
}  # channels.INLINE_TYPES 와 같은 집합


def _sniff(data: bytes) -> str | None:
    for magic, content_type in MAGIC:
        if data.startswith(magic):
            return content_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _key(file_id: uuid.UUID) -> str:
    return f"files/{file_id}"


class FileOut(BaseModel):
    id: uuid.UUID
    url: str
    name: str
    size: int


@router.post(
    "/files",
    status_code=201,
    response_model=FileOut,
    summary="문서 이미지 업로드 — multipart `file`(png·jpeg·gif·webp, 10MB, 하루 200장) → MinIO. 04 에 없던 경로",
)
async def upload_file(
    file: UploadFile,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    since = datetime.now(UTC) - timedelta(days=1)
    if await audit.count_since(db, "files.uploaded", since, actor=str(user.id)) >= DAILY_UPLOADS:
        raise ApiError(429, "UPLOAD_THROTTLED", "오늘 올릴 수 있는 이미지 수를 넘었습니다.")
    # 거대한 본문은 main.py 의 body_limit 가 Content-Length 로 먼저 끊는다. 여기서는 상한 + 1 바이트만 읽어 판정.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(422, "VALIDATION", "10MB 이하 이미지만 올릴 수 있습니다.")
    if not data:
        raise ApiError(422, "VALIDATION", "빈 파일입니다.")
    content_type = _sniff(data)
    if content_type is None:
        # svg·html 을 올리려는 시도는 탐색 행위일 수 있다 — 무엇을 어떤 이름으로 우겼는지 남긴다
        audit.record(
            db,
            "files.rejected",
            request=request,
            actor_id=user.id,
            detail={"claimed": file.content_type, "name": storage.safe_name(file.filename)},
        )
        await db.commit()
        raise ApiError(422, "VALIDATION", "png·jpeg·gif·webp 이미지만 올릴 수 있습니다.")
    file_id = uuid.uuid4()
    await storage.put(_key(file_id), data, content_type)
    audit.record(
        db,
        "files.uploaded",
        request=request,
        actor_id=user.id,
        target_id=file_id,
        detail={"actor": str(user.id), "size": len(data), "type": content_type},
    )
    await db.commit()
    return FileOut(
        id=file_id,
        url=f"/api/files/{file_id}",
        name=storage.safe_name(file.filename),
        size=len(data),
    )


@router.get(
    "/files/{id}",
    summary="문서 이미지 — 로그인한 사람 누구나(문서에 열람 등급 없음). <img src> 가 쿠키로 인증된다",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}}},
    dependencies=[Depends(current_user)],
)
async def download_file(id: uuid.UUID) -> Response:
    found = await storage.get(_key(id))
    if found is None:
        raise ApiError(404, "NOT_FOUND", "없는 파일입니다.")
    data, content_type = found
    # 쓰는 쪽이 매직 바이트로 못박지만, 읽는 쪽도 같은 목록으로 닫는다 — inline 으로 나가는 값이라 MinIO 메타데이터를 믿지 않는다.
    if content_type not in ALLOWED_TYPES:
        raise ApiError(404, "NOT_FOUND", "없는 파일입니다.")
    return Response(
        data,
        media_type=content_type,
        headers={
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            # 사용자 바이트를 같은 오리진에서 inline 으로 낸다 — 주소창에 직접 열어도 이 응답 안에서는 아무것도 실행되지 않게.
            "Content-Security-Policy": "default-src 'none'; sandbox",
            # 키에 랜덤 id — 불변. main.py 의 no-store 는 setdefault 라 이 값이 남는다.
            "Cache-Control": "private, max-age=86400",
        },
    )
