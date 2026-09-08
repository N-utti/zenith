"""04 §0 커서 페이징 — (시각, id) 를 불투명 문자열로. /admin/audit 과 /channels/{id}/messages 가 같이 쓴다."""

import base64
import binascii
import uuid
from datetime import datetime

from app.errors import ApiError


def encode_cursor(at: datetime, id_: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{id_}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        at, id_ = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(at), uuid.UUID(id_)
    except (ValueError, UnicodeDecodeError, binascii.Error) as e:
        raise ApiError(422, "VALIDATION", "cursor 형식이 잘못됐습니다.") from e
