"""사용자 환경설정 — `users.preferences` JSONB 한 칸. 04 에 없는 경로(이슈 #81), README "설계와 어긋나는 것" 17.

서버에 남아야 하는 값만 여기 둔다: 알림 종류별 수신 여부와 로그인 직후 시작 화면. 테마·사이드바 접힘·문서
트리 펼침은 기기마다 달라도 되는 값이라 브라우저(localStorage)에 그대로 둔다.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

StartPage = Literal["/", "/docs", "/chat", "/board", "/attendance"]


class NotificationPrefs(BaseModel):
    """03 `notifications.kind` 와 같은 키. 근태(`att_*`, 04 §10.5)·결재(`apv_*`, 13 §9.4)는 종류가 여럿이라
    묶음 하나로 받는다 — `wants()` 가 접두사로 되돌린다."""

    mention: bool = True
    comment: bool = True
    reply: bool = True
    post: bool = True
    attendance: bool = True
    approval: bool = True


class NotificationPatch(BaseModel):
    """준 종류만 덮어쓴다 — 모르는 종류는 422(프론트 오타가 조용히 무시되지 않게)."""

    model_config = ConfigDict(extra="forbid")

    mention: bool | None = None
    comment: bool | None = None
    reply: bool | None = None
    post: bool | None = None
    attendance: bool | None = None
    approval: bool | None = None


class Preferences(BaseModel):
    notifications: NotificationPrefs = NotificationPrefs()
    start_page: StartPage = "/"


class PreferencesPatch(BaseModel):
    """부분 갱신 — 준 것만 덮어쓴다. null 은 "안 준 것"과 같다."""

    model_config = ConfigDict(extra="forbid")

    notifications: NotificationPatch | None = None
    start_page: StartPage | None = None


def merged(stored: dict | None) -> Preferences:
    """저장된 칸(없으면 null)을 기본값과 합쳐 전체 모양으로."""
    try:
        return Preferences.model_validate(stored or {})
    except ValidationError:
        # 스키마에서 빠진 옛 값(사라진 라우트를 시작 화면으로 골라 둔 사람)이 읽기·쓰기를 막지 않게.
        # ponytail: 값 단위로 살려 내지 않는다 — 그 사람만 기본값으로 돌아가고 다시 고르면 된다.
        return Preferences()


def wants(stored: dict | None, kind: str) -> bool:
    """이 사용자가 그 종류의 알림을 받는가. 미설정·모르는 종류는 받는다(기본 켜짐)."""
    if kind.startswith("att_"):
        kind = "attendance"
    elif kind.startswith("apv_"):
        kind = "approval"
    return bool((stored or {}).get("notifications", {}).get(kind, True))
