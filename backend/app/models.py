"""03-ERD·DB 설계서 §1 핵심 테이블 + §2.6 teams.

- 근태(§3)·전자결재(13 §4) 표는 맨 아래 — 13 §7.2 대로 근태 신청 4표에 status/approver_id 가 없고 결재 문서가
  상태를 든다(README "설계와 어긋나는 것" 35·36).
- 인덱스는 03 §2.4 그대로.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, defer, mapped_column

from app.db import Base

Role = Literal["member", "lead", "exec"]
ROLE_RANK: dict[str, int] = {"member": 1, "lead": 2, "exec": 3}  # 03 §2.2 서열

EMBEDDING_DIM = 1024  # bge-m3 · voyage-3 계열 모두 1024


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=sql_text("gen_random_uuid()")
    )


def created_at_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=sql_text("now()"))


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (  # 이름 유일 — 같은 이름 팀 둘이면 배정 화면에서 구분이 안 된다(03 에 없는 제약)
        Index("uq_teams_name", "name", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # users.team_id 와 순환 참조 → 한쪽은 ALTER 로 뒤에 건다.
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", use_alter=True, name="fk_teams_lead_id_users")
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    pw_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="member")
    avatar: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("true"))
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    hire_date: Mapped[date | None] = mapped_column(Date)
    # 알림 수신·시작 화면 (app/prefs.py). null 이면 기본값 — 03 에 없던 컬럼 (2026-09-17)
    preferences: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at_col()


class AuthSession(Base):
    """refresh 토큰의 서버측 기록 — 회전(jti 교체)과 회수(revoked_at)로 로그아웃·강제 종료를 실현한다.

    03-ERD 에 없던 테이블. 근거: NFR-02 "JWT 만료·회전", 11 §4.1 서버측 세션, 11 I15 즉시 차단.
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("idx_auth_sessions_user", "user_id", "revoked_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 지금 유효한 refresh 토큰의 id. 회전 뒤 옛 토큰이 오면 탈취로 보고 세션을 닫는다.
    refresh_jti: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    last_used_at: Mapped[datetime] = created_at_col()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(Text)


class AuditEvent(Base):
    """append-only 감사 기록 (04 §9 /admin/audit · 11 §7.4). 수정·삭제 경로를 만들지 않는다."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("idx_audit_kind_at", "kind", sql_text("at DESC")),
        Index("idx_audit_actor_at", "actor_id", sql_text("at DESC")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    at: Mapped[datetime] = created_at_col()
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # auth.* · acl.* · admin.*
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # 대상 리소스 id. 어느 테이블이든 가리킬 수 있어 FK 를 걸지 않는다.
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict | None] = mapped_column(JSONB)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (Index("idx_folders_tree", "ws_id", "parent_id", "sort"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    ws_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("folders.id"))  # NULL=루트
    title: Mapped[str] = mapped_column(Text, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # 열람 최소 등급(README 57) — 게시판 min_role 과 같은 서열. 조상 폴더가 막히면 그 아래도 안 보인다(app/acl.py)
    min_role: Mapped[str] = mapped_column(Text, nullable=False, server_default="member")


class FolderMember(Base):
    """폴더 사람 지정(README 57) — 등급과 무관하게 이 사람에게 연다. 폴더·사람이 지워지면 같이 지워진다(CASCADE)."""

    __tablename__ = "folder_members"

    folder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = created_at_col()


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (Index("idx_documents_tsv", "tsv", postgresql_using="gin"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    folder_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("folders.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    ydoc_snapshot: Mapped[bytes | None] = mapped_column(LargeBinary)  # Yjs 원본 (03 §2.1)
    text_cache: Mapped[str | None] = mapped_column(Text)  # 검색용 파생
    tsv: Mapped[str | None] = mapped_column(TSVECTOR)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # ORM UPDATE 때 now() 로 갱신된다. 원시 SQL 로 고치면 직접 세팅해야 한다.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=sql_text("now()"),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 휴지통
    # 「AI 근거로 쓰기」 스위치(03 에 없던 칸, 2026-10-12 — README 43). AI 답변을 저장한 문서는 false 로 만들어진다
    ai_source: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


# 문서 **목록**(트리·휴지통·홈·검색)에 붙이는 로더 옵션. 목록은 제목·시각만 쓰는데, 엔티티를 그냥 뽑으면
# 본문 원본(Y.Doc, gc 가 꺼져 있어 줄지 않는다)·평문·tsv 까지 문서 수만큼 끌고 온다(2026-09-21 측정:
# 600건 `/tree` 111ms → 16ms). raiseload 라 목록 경로에서 이 칸을 읽으면 MissingGreenlet 대신 칸 이름이 찍힌 오류가 난다.
DOC_LIST_OPTS = (
    defer(Document.ydoc_snapshot, raiseload=True),
    defer(Document.text_cache, raiseload=True),
    defer(Document.tsv, raiseload=True),
)


class DocVersion(Base):
    """Yjs 스냅샷(시점 표식). 내용 사본이 아니라 gc:false 인 Y.Doc 이력에서 되살린다(frontend/README).

    03 에 없던 컬럼 둘: author_id(누가 남겼나 — 3분 접기 기준), label(되돌리기처럼 이유가 있는 버전).
    """

    __tablename__ = "doc_versions"
    __table_args__ = (Index("idx_doc_versions_doc", "doc_id", sql_text("created_at DESC")),)

    id: Mapped[uuid.UUID] = uuid_pk()
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), nullable=False)
    snapshot: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    label: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()


class DocComment(Base):
    __tablename__ = "doc_comments"
    __table_args__ = (Index("idx_doc_comments_doc", "doc_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), nullable=False)
    block_id: Mapped[str | None] = mapped_column(Text)  # 블록 앵커(선택)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # 고친 적 없으면 NULL (#274)


class StoredFile(Base):
    """`POST /files` 로 올린 파일의 기록부(03 에 없는 표, 2026-10-02 — README 16 · 이슈 #224·#226).

    오브젝트는 MinIO `files/{id}` 에 있고 여기는 이름·크기·형식·올린 사람·어느 문서인지만. 내려받기 이름의 출처이자
    자료실(#226) 목록의 근거. 표가 생기기 전에 올린 그림은 행이 없다(내려받기는 MinIO 메타데이터로 된다)."""

    __tablename__ = "files"
    __table_args__ = (Index("idx_files_doc", "doc_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)  # 서버가 앞 바이트로 판정한 값
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 어느 문서에서 올렸나(프론트가 폼으로 보낸다). 없으면 출처 모름 — 자료실에 안 실린다
    doc_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"))
    created_at: Mapped[datetime] = created_at_col()


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (  # 공개 채널 이름 유일 — 사전 검사와 commit 사이 경합은 이게 막는다(409).
        # 비공개 채널은 빼야 한다 — 같은 이름으로 409 가 나면 안 보이는 채널이 있다는 사실이 샌다(README 12).
        Index(
            "uq_channels_public_name",
            "name",
            unique=True,
            postgresql_where=sql_text("NOT is_dm AND NOT is_private"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    ws_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_dm: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    # 고른 사람만 멤버(03 에 없는 칸, 2026-10-02). 공개 채널(전원)·DM(두 사람)과 달리 멤버를 더하고 뺀다.
    is_private: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    # 연 사람(03 에 없는 칸, 2026-10-06 — 이슈 #349). 비공개 채널 지우기 권한의 근거. 이 칸 전의 행은 NULL —
    # 그때는 멤버인 임원이 지운다.
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class ChannelMember(Base):
    __tablename__ = "channel_members"

    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 안읽음 기준
    # 내 목록에서 치운 시각(DM 숨기기, 03 에 없는 칸 — 이슈 #268). 새 메시지·DM 다시 열기가 NULL 로 되돌린다.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"
    # tsv(생성 컬럼)는 서버 기본값으로 잡혀, 기본 설정이면 INSERT 의 RETURNING 에 tsvector 가 통째로 딸려 온다.
    # deferred 는 SELECT 만 막는다. id 는 PK 라 따로 돌아오고, created_at 은 만드는 쪽이 항상 채운다.
    __mapper_args__ = {"eager_defaults": False}
    __table_args__ = (
        Index("idx_messages_channel", "channel_id", sql_text("created_at DESC")),
        Index("idx_messages_tsv", "tsv", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    doc_ref: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"))  # 문서 카드
    attachments: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at_col()
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # 고친 적 없으면 NULL (#264)
    # 검색용 파생(03 §2.4 식). DB 가 본문에서 만들어 저장한다 — 앱은 쓰지 않고, 읽을 때도 딸려 오지 않는다
    # (deferred + 위 eager_defaults). 즉석 to_tsvector 는 일치한 행마다 ts_rank 가 다시 계산해 흔한 단어에서 느렸다.
    tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', body)", persisted=True),
        deferred=True,
        deferred_raiseload=True,
    )


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    min_role: Mapped[str] = mapped_column(Text, nullable=False, server_default="member")


class Post(Base):
    __tablename__ = "posts"
    # Message 와 같다. tsv(생성 컬럼)는 서버 기본값으로 잡혀, 기본 설정이면 INSERT 의 RETURNING 에 tsvector 가 통째로 딸려 온다.
    # deferred 는 SELECT 만 막는다. id 는 PK 라 따로 돌아오고, created_at 은 만드는 쪽이 항상 채운다.
    __mapper_args__ = {"eager_defaults": False}
    __table_args__ = (Index("idx_posts_tsv", "tsv", postgresql_using="gin"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    board_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("boards.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 채팅 첨부와 같은 모양 (#299, README 34). none_as_null — 없는 글은 SQL NULL(JSON null 이면 IS NULL 로 못 거른다)
    attachments: Mapped[list | None] = mapped_column(JSONB(none_as_null=True))
    created_at: Mapped[datetime] = created_at_col()
    # Message.tsv 와 같은 이유. 제목도 검색 대상이라 함께 넣는다
    tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', title) || to_tsvector('simple', body)", persisted=True),
        deferred=True,
        deferred_raiseload=True,
    )


class BoardUpload(Base):
    """게시글 첨부 업로드 기록부(03 에 없는 표, 2026-10-06 — README 34 · 이슈 #309).

    오브젝트는 MinIO `boards/{board_id}/{file_id}/{name}` 에 있고 여기는 누가 어느 게시판에 올렸나만.
    글에 새로 싣는 url 은 올린 사람 본인 것만 받는다 — 남이 뗀 파일 url 을 자기 글에 박아 두고 회수를 피하는 길을 막는다."""

    __tablename__ = "board_uploads"

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )  # 앱이 만든다 — 저장 키와 같아야 한다
    board_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("boards.id"), nullable=False)
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 글에 실리는 size·content_type 은 이 값으로 덮어쓴다(클라이언트 값을 믿지 않는다)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class ChannelUpload(Base):
    """채팅 첨부 업로드 기록부 — BoardUpload 와 같은 이유(2026-10-06, README 15(h) · 이슈 #324)."""

    __tablename__ = "channel_uploads"

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )  # 앱이 만든다 — 저장 키와 같아야 한다
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id"), nullable=False)
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 메시지에 실리는 size·content_type 은 이 값으로 덮어쓴다(클라이언트 값을 믿지 않는다)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class PostComment(Base):
    """게시글 댓글(03 에 없는 표, 2026-10-02 — README 33). 문서 댓글에서 블록 칸을 뺀 모양. 글이 지워지면 DB 가 같이 지운다."""

    __tablename__ = "post_comments"
    __table_args__ = (Index("idx_post_comments_post", "post_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Todo(Base):
    __tablename__ = "todos"
    __table_args__ = (Index("idx_todos_user", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    created_at: Mapped[datetime] = created_at_col()  # 03 에 없던 컬럼 — 목록 순서 (2026-09-07)


class Project(Base):
    """협업 공간의 프로젝트(03 에 없는 표, 2026-10-12 — README 40, 프론트 #359). 전 직원이 본다."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class ProjectTask(Base):
    """프로젝트의 업무 카드. 프로젝트를 지우면 같이 지워진다(ON DELETE CASCADE)."""

    __tablename__ = "project_tasks"
    __table_args__ = (Index("idx_project_tasks_project", "project_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="todo")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    start_date: Mapped[date | None] = mapped_column(Date)  # 일정 탭 간트 막대의 왼쪽 끝 (#520)
    due_date: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(Text, nullable=False, server_default="normal")
    note: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    created_at: Mapped[datetime] = created_at_col()


class Event(Base):
    """홈 캘린더의 개인 일정(03 에 없는 표, 2026-10-02 — README 31). 할 일(`todos`)과 같은 꼴, 본인만 본다."""

    __tablename__ = "events"
    __table_args__ = (Index("idx_events_user_date", "user_id", "date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    time: Mapped[str | None] = mapped_column(Text)  # "HH:MM" — 프론트가 그대로 그린다. 없으면 종일
    created_at: Mapped[datetime] = created_at_col()


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("idx_notifications_user", "user_id", "read_at", sql_text("created_at DESC")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # mention|comment|reply|post · att_* (04 §10.5) · apv_* (13 §9.4)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class AiSession(Base):
    __tablename__ = "ai_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class AiMessage(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (Index("idx_ai_messages_session", "session_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_sessions.id"), nullable=False)
    msg_role: Mapped[str] = mapped_column(Text, nullable=False)  # user|assistant
    body: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list | None] = mapped_column(JSONB)  # 각주 매핑 (04 §8.1)
    feedback: Mapped[int | None] = mapped_column(Integer)  # 1 도움돼요 / -1
    created_at: Mapped[datetime] = (
        created_at_col()
    )  # 03 에 없던 칸 — 대화 순서 (2026-10-12, README 41)


class AiAttachment(Base):
    """AI 첨부(README 51, 03 에 없는 표) — 올린 사람만 쓴다. 평문은 서버가 뽑아 둔 것(최대 20만 자), 원본은 MinIO
    `ai/{user_id}/{id}/{name}`. 7일 뒤 `ai.purge_attachments_loop` 가 둘 다 지운다."""

    __tablename__ = "ai_attachments"
    __table_args__ = (Index("idx_ai_attachments_user", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )  # 앱이 만든다(저장 키와 같다)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sql_text("now()")
    )


class AiFeedback(Base):
    """`POST /ai/feedback`(README 37). `message_id` 는 문자열 — 대화 저장(README 41) 전 프론트는 자기가 만든 답변 id 를
    보냈고, 저장 뒤에는 `done` 이 준 서버 id 를 보낸다(그때는 ai_messages.feedback 에도 적는다)."""

    __tablename__ = "ai_feedback"
    __table_args__ = (UniqueConstraint("user_id", "message_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    message_id: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 도움돼요 / -1
    created_at: Mapped[datetime] = created_at_col()


class DocChunk(Base):
    __tablename__ = "doc_chunks"
    __table_args__ = (
        Index(
            "idx_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("idx_chunks_acl", "acl_role"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), nullable=False)
    chunk_no: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    acl_role: Mapped[str] = mapped_column(Text, nullable=False)  # RAG 권한 필터 (03 §2.2)


# ── CRM 주소록·안건 (03 에 없는 표, 2026-10-02 — README 32 · 15 CRM 모듈 설계서) ─────────────────
# 프론트 목(`mocks/crmDb.ts`)을 역설계한 계약 그대로. 지우는 길은 soft delete(기관·활동)와 개인정보 비우기(담당자)뿐 —
# 행을 지우면 활동 기록의 참석자·이력이 깨진다.


class CrmOrg(Base):
    __tablename__ = "crm_orgs"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 정규화 이름 — `(주)`·`㈜`·`주식회사`·공백을 빼고 소문자(routers/crm.py normalize_org_name). 검색·중복·정렬
    name_norm: Mapped[str] = mapped_column(Text, nullable=False)
    org_type: Mapped[str] = mapped_column(Text, nullable=False)
    memo: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    created_at: Mapped[datetime] = created_at_col()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 임원 삭제
    deleted_reason: Mapped[str | None] = mapped_column(Text)  # 지울 때 적은 사유(지운 기관 목록)
    # 이 기관을 만든 CSV 가져오기 — 되돌리기가 지울 대상(README 32 추가)
    import_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("crm_imports.id"))


class CrmImport(Base):
    """반영된 CSV 가져오기 한 번. 되돌리기(24시간 안, 가져온 사람만)의 근거 — 만든 행은 `import_id` 로 가리킨다."""

    __tablename__ = "crm_imports"
    __table_args__ = (Index("idx_crm_imports_user", "user_id", sql_text("created_at DESC")),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CrmOrgOwner(Base):
    """사내 창구 — 이 기관을 맡은 우리 쪽 사람(N:N)."""

    __tablename__ = "crm_org_owners"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)


class CrmContact(Base):
    __tablename__ = "crm_contacts"
    __table_args__ = (Index("idx_crm_contacts_org", "org_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    phone: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    email: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    memo: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # 개인정보 삭제 — 위 칸을 "" 로 비우고 행은 남긴다(활동 참석자·이직 이력 유지)
    erased: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    created_at: Mapped[datetime] = created_at_col()
    # 등록한 사람 — 활동에 붙기 전까지 지울 수 있다. 이 칸이 생기기 전 행은 NULL(임원만 지운다)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # 목록에서 뺀 시각. 행은 남아 활동 참석자 이름으로 보인다(개인정보 비우기는 erased)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    import_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("crm_imports.id"))


class CrmContactMove(Base):
    """이직 이력. 옛 활동은 기록 당시 기관에 남는다."""

    __tablename__ = "crm_contact_moves"
    __table_args__ = (Index("idx_crm_contact_moves_contact", "contact_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_contacts.id"), nullable=False)
    from_org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), nullable=False)
    to_org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), nullable=False)
    moved_at: Mapped[datetime] = created_at_col()
    # 옮긴 사람 — 등록한 사람의 담당자 지우기 판정(남이 옮겼으면 쓰인 것). 이 칸 전의 행은 NULL(남의 것으로 본다)
    moved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class CrmDeal(Base):
    __tablename__ = "crm_deals"
    __table_args__ = (Index("idx_crm_deals_org", "org_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # fundraising|investment|disposal
    name: Mapped[str] = mapped_column(Text, nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    stage: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # 종류별 단계 키(routers/crm.py STAGES)
    amount_krw: Mapped[int | None] = mapped_column(
        BigInteger
    )  # 원 단위 — 수천억이라 int4 를 넘는다
    target_date: Mapped[date | None] = mapped_column(Date)
    next_action: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    next_action_due: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="open"
    )  # open|won|dropped
    drop_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")  # 낙관적 잠금
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    # 지운 안건 — 보드·목록·내보내기에서 빠지고 상세는 404. 이력·활동 연결은 남는다
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CrmDealEvent(Base):
    """안건 이력 — 단계 이동(move)·중단(drop)·재개(reopen)."""

    __tablename__ = "crm_deal_events"
    __table_args__ = (Index("idx_crm_deal_events_deal", "deal_id", sql_text("created_at DESC")),)

    id: Mapped[uuid.UUID] = uuid_pk()
    deal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_deals.id"), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    from_stage: Mapped[str | None] = mapped_column(Text)
    to_stage: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)  # move|drop|reopen
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()


class CrmActivity(Base):
    __tablename__ = "crm_activities"
    __table_args__ = (
        Index("idx_crm_activities_org", "org_id", sql_text("occurred_at DESC")),
        Index("idx_crm_activities_deal", "deal_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # meeting|call|email|memo
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_orgs.id"), nullable=False)
    deal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("crm_deals.id"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CrmActivityContact(Base):
    """활동의 외부 참석자(그 기관 담당자)."""

    __tablename__ = "crm_activity_contacts"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("crm_activities.id"), primary_key=True
    )
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crm_contacts.id"), primary_key=True)


class CrmActivityUser(Base):
    """활동의 사내 참석자."""

    __tablename__ = "crm_activity_users"

    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("crm_activities.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)


# ── 전자결재 (13 §4 — README 35) ─────────────────────────────────────────────


class ApprovalDocument(Base):
    """결재 문서. 엔진은 누가·언제·어떤 순서로만 들고, 무엇을 결재하는지는 `subject`(JSONB)가 든다(13 §1.2).

    근태 신청 4종은 신청 행이 `approval_id` 로 이 문서를 가리키고, 신청 상태는 이 문서의 `status` 에서 읽는다(13 §7.2).
    """

    __tablename__ = "approval_documents"
    __table_args__ = (Index("idx_apv_docs_drafter", "drafter_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    type_code: Mapped[str] = mapped_column(Text, nullable=False)  # general|leave|arrangement|…
    drafter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # draft|pending|approved|rejected|canceled|closed (13 §6.1, closed = 임원 강제 종결)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    # {body, amount, related, attachments?, extra?} — 프론트 GeneralSubject 그대로
    subject: Mapped[dict] = mapped_column(JSONB, nullable=False)
    amount: Mapped[int | None] = mapped_column(BigInteger)  # 원. 전결 판정용(#158 A4 — 아직 안 씀)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class ApprovalStep(Base):
    """결재선 한 줄(13 §4.2). 참조자는 `role=reference, status=skipped` — 대기 사슬에 들지 않는다."""

    __tablename__ = "approval_steps"
    __table_args__ = (
        Index("uq_apv_steps_doc_no", "doc_id", "step_no", unique=True),
        Index("idx_apv_steps_approver", "approver_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("approval_documents.id"), nullable=False)
    step_no: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 원 결재자가 아닌 사람이 처리했을 때만 — 대결(위임)·강제 종결
    acted_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(Text, nullable=False)  # approve|reference
    # waiting|approved|rejected|delegated_done|skipped (13 §6.2)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 낙관 잠금(13 §4.2.5) — 승인·반려 요청이 되돌려 보낸 값과 같아야 한다
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")


class ApprovalDelegation(Base):
    """결재 위임(13 §4.2.3) — 기간 동안 `delegate` 가 `owner` 차례를 대신 처리한다. `type_code` NULL = 모든 유형."""

    __tablename__ = "approval_delegations"
    __table_args__ = (Index("idx_apv_delegations_owner", "owner_id", "start_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    delegate_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    type_code: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()


# ── 근태 (10 §4.1 — README 36) ───────────────────────────────────────────────
# 신청 4표는 상태 칸이 없다(13 §7.2) — `approval_id` 의 문서 상태가 곧 신청 상태다.


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    __table_args__ = (Index("idx_leave_requests_user", "user_id", "start_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    type_code: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[float] = mapped_column(Float, nullable=False)  # 신청 때 산출한 차감 일수(0.5 단위)
    reason: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    approval_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_documents.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = created_at_col()


class WorkArrangement(Base):
    """재택·외근·출장 사전 등록."""

    __tablename__ = "work_arrangements"
    __table_args__ = (Index("idx_work_arrangements_user", "user_id", "start_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # remote|field|trip
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    approval_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_documents.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = created_at_col()


class OvertimeRequest(Base):
    __tablename__ = "overtime_requests"
    __table_args__ = (Index("idx_overtime_requests_user", "user_id", "work_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # "HH:MM" — events.time 과 같은 이유
    end_time: Mapped[str] = mapped_column(Text, nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)  # 서버 산출(10 §5.3)
    night_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    approval_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_documents.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = created_at_col()


class AttCorrection(Base):
    __tablename__ = "att_corrections"
    __table_args__ = (Index("idx_att_corrections_user", "user_id", "work_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    after: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {status?, note?}
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    approval_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_documents.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = created_at_col()


class Holiday(Base):
    """공휴일·회사 휴일(10 §6.1) — 근무 달력의 유일한 입력. 근무일은 주말과 이 표를 빼고 그때그때 센다."""

    __tablename__ = "holidays"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # public|company


class AttClosing(Base):
    """월 마감(10 §5.5). 행이 있으면 마감된 달, 해제는 행을 지운다. 이력은 감사 로그(attendance.closed·reopened)."""

    __tablename__ = "att_closings"

    month: Mapped[str] = mapped_column(Text, primary_key=True)  # "YYYY-MM"
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
