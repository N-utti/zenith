"""문서 파일 업로드 — 04 에 없는 경로(README "설계와 어긋나는 것" 16). ARCHITECTURE §2 "MinIO: 문서 이미지·채팅 첨부".

프론트 편집기(frontend/src/features/docs/useFileUpload.ts)는 `POST /files` 로 올리고 본문(Y.Doc)에는 `url` 만 넣는다 —
바이너리를 Y.Doc 에 담으면 버전 스냅샷마다 복사된다. 문서에 열람 등급이 없으므로(04 §3) 로그인한 사람은 누구나
읽는다. 처음(2026-09-16)엔 그림 넷만 받았고, 2026-10-02(이슈 #224)부터 어떤 파일이든 받는다 — 브라우저가
inline 으로 안전하게 그리는 그림 넷만 inline, 나머지는 전부 attachment(svg·html 은 같은 오리진 XSS). 판정은
Content-Type 헤더가 아니라 앞 바이트로, 그림이 아니면 올린 쪽이 우긴 형식을 믿지 않고 octet-stream 으로 둔다.
서버는 이미지를 디코딩하지 않는다(픽셀 폭탄 무관).

올린 파일의 이름·크기·형식·올린 사람·어느 문서인지는 `files` 표(03 에 없는 표, alembic 8c3f1d2e9b47)에 남긴다 —
내려받기 이름의 출처를 문서 본문(같이 편집하는 사람이 바꿀 수 있다)이 아니라 서버로 옮기고, 자료실(#226)이 목록을
만들 근거다. 표가 생기기 전(2026-10-02 이전)에 올라간 그림은 행이 없다 — 내려받기는 MinIO 메타데이터로 그대로 된다.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import acl, audit, storage
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import Document, StoredFile, User

router = APIRouter(tags=["files"])

MAX_FILE_BYTES = 10 * 1024 * 1024  # 프론트 useFileUpload.ts 의 MAX_FILE_BYTES 와 같은 값
# 사용자별 하루 상한(그림·파일 합쳐서). miniodata 가 db 와 같은 디스크라 저장소 포화는 전면 장애다 — 감사 로그를 세어 판정.
# ponytail: 총량(디스크) 감시와 미참조 오브젝트 정리는 없다 — 15명·200개/일이면 하루 최대 30GB 가 천장.
DAILY_UPLOADS = 200
# 매직 바이트 → content type. 헤더는 클라이언트가 정하는 값이라 믿지 않는다.
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)
# 브라우저가 inline 으로 그려도 스크립트가 돌지 않는 형식만 — channels.INLINE_TYPES 와 같은 집합
INLINE_TYPES = frozenset(ct for _, ct in MAGIC) | {"image/webp"}
OCTET = "application/octet-stream"


def _sniff(data: bytes) -> str:
    """그림 넷이면 그 형식, 아니면 octet-stream — 우긴 Content-Type 은 보지 않는다."""
    for magic, content_type in MAGIC:
        if data.startswith(magic):
            return content_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return OCTET


def _key(file_id: uuid.UUID) -> str:
    return f"files/{file_id}"


class FileOut(BaseModel):
    id: uuid.UUID
    url: str
    name: str
    size: int
    # 서버가 앞 바이트로 판정한 값 — 프론트는 이걸로 사진 블록과 파일 칩을 가른다(#224)
    content_type: str


@router.post(
    "/files",
    status_code=201,
    response_model=FileOut,
    summary="문서 파일 업로드 — multipart `file`(어떤 형식이든, 10MB, 하루 200개) + `doc_id`(선택) → MinIO. 04 에 없던 경로",
)
async def upload_file(
    file: UploadFile,
    request: Request,
    doc_id: Annotated[uuid.UUID | None, Form()] = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    since = datetime.now(UTC) - timedelta(days=1)
    if await audit.count_since(db, "files.uploaded", since, actor=str(user.id)) >= DAILY_UPLOADS:
        raise ApiError(429, "UPLOAD_THROTTLED", "오늘 올릴 수 있는 파일 수를 넘었습니다.")
    if doc_id is not None:
        doc = await db.get(Document, doc_id)
        # 휴지통 문서·못 보는 문서도 없는 것으로(README 57) — 남의 폴더 문서에 파일을 붙이거나 존재를 알아내지 못하게
        if (
            doc is None
            or doc.deleted_at is not None
            or not await acl.can_view_folder(db, user, doc.folder_id)
        ):
            raise ApiError(422, "VALIDATION", "없는 문서입니다.")
    # 거대한 본문은 main.py 의 body_limit 가 Content-Length 로 먼저 끊는다. 여기서는 상한 + 1 바이트만 읽어 판정.
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(422, "VALIDATION", "10MB 이하 파일만 올릴 수 있습니다.")
    if not data:
        raise ApiError(422, "VALIDATION", "빈 파일입니다.")
    content_type = _sniff(data)
    name = storage.safe_name(file.filename)
    row = StoredFile(
        name=name, size=len(data), content_type=content_type, uploader_id=user.id, doc_id=doc_id
    )
    db.add(row)
    await db.flush()  # id
    await storage.put(_key(row.id), data, content_type)
    audit.record(
        db,
        "files.uploaded",
        request=request,
        actor_id=user.id,
        target_id=row.id,
        detail={"actor": str(user.id), "size": len(data), "type": content_type},
    )
    await db.commit()
    return FileOut(
        id=row.id, url=f"/api/files/{row.id}", name=name, size=len(data), content_type=content_type
    )


_FILE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    # 사용자 바이트를 같은 오리진에서 낸다 — 주소창에 직접 열어도 이 응답 안에서는 아무것도 실행되지 않게.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    # no-cache + ETag (#328): 저장은 하되 열 때마다 쿠키로 재검증한다 — 하루 캐시(max-age)는 같은 브라우저의
    # 다음 로그인 사용자·로그아웃 뒤에도 서버 판정 없이 열렸다. 문서 본문의 인라인 이미지가 많아 첨부처럼
    # no-store 로 하지 않고 304 로 비용을 줄인다. main.py 의 no-store 는 setdefault 라 이 값이 남는다.
    "Cache-Control": "private, no-cache",
}


@router.get(
    "/files/{id}",
    summary="문서 파일 — 로그인한 사람 누구나(문서에 열람 등급 없음). 그림 넷은 inline(<img src>), 나머지는 attachment",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
    dependencies=[Depends(current_user)],
)
async def download_file(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # 폴더 열람 권한(README 57) — 문서에 붙은 파일은 그 문서를 볼 수 있어야. 304 분기보다 위(ponytail 메모대로).
    row = await db.get(StoredFile, id)
    if (
        row is not None
        and row.doc_id is not None
        and not await acl.can_view_doc(db, user, row.doc_id)
    ):
        audit.record(
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=id,
            detail={"path": request.url.path, "doc_id": str(row.doc_id)},
        )
        await db.commit()
        raise ApiError(403, "FORBIDDEN", "이 파일을 볼 권한이 없습니다.")
    # 키에 랜덤 id — 불변. 그래서 ETag 는 id 하나로 충분하고, 재검증 요청은 MinIO 를 안 탄다(#328).
    etag = f'"{id}"'
    if request.headers.get("if-none-match") == etag:
        # 304 의 헤더가 캐시된 응답의 헤더를 덮어쓴다(RFC 9111 §4.3.4) — 보안 헤더도 200 과 같게 다시 보낸다
        return Response(status_code=304, headers={**_FILE_HEADERS, "ETag": etag})
    found = await storage.get(_key(id))
    if found is None:
        raise ApiError(404, "NOT_FOUND", "없는 파일입니다.")
    data, content_type = found
    # 쓰는 쪽이 매직 바이트로 못박지만, 읽는 쪽도 같은 목록으로 닫는다 — inline 으로 나가는 값이라 MinIO 메타데이터를 믿지 않는다.
    if content_type in INLINE_TYPES:
        disposition = "inline"
    else:
        # 2026-10-02 이전 그림은 행이 없지만 그건 전부 inline 쪽이다
        name = row.name if row else "file"
        # RFC 6266 — 한글 파일명은 filename* 로. 프론트는 fetch 로 받아 저장하므로 이 이름에 기대지 않지만 주소창 직접 열기용.
        disposition = f"attachment; filename*=UTF-8''{quote(name, safe='')}"
        content_type = OCTET
    return Response(
        data,
        media_type=content_type,
        headers={"Content-Disposition": disposition, **_FILE_HEADERS, "ETag": etag},
    )
