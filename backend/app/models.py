"""03-ERD·DB 설계서 §1 핵심 테이블 + §2.6 teams.

- 근태(§3)·전자결재(13 §4) 테이블은 넣지 않았다. 13 §7.2가 근태 신청 4개 테이블의 status/approver_id
  컬럼 제거를 요구하는데 10번 v0.4 재작성(13 A9)과 로드맵(13 A2)이 미결이라, 두 문서가 합쳐진 뒤 추가한다.
- 인덱스는 03 §2.4 그대로.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
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
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 고친 적 없으면 NULL (#274)


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
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 고친 적 없으면 NULL (#264)
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
    created_at: Mapped[datetime] = created_at_col()
    # Message.tsv 와 같은 이유. 제목도 검색 대상이라 함께 넣는다
    tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', title) || to_tsvector('simple', body)", persisted=True),
        deferred=True,
        deferred_raiseload=True,
    )


class Todo(Base):
    __tablename__ = "todos"
    __table_args__ = (Index("idx_todos_user", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    created_at: Mapped[datetime] = created_at_col()  # 03 에 없던 컬럼 — 목록 순서 (2026-09-07)


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

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_sessions.id"), nullable=False)
    msg_role: Mapped[str] = mapped_column(Text, nullable=False)  # user|assistant
    body: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list | None] = mapped_column(JSONB)  # 각주 매핑 (04 §8.1)
    feedback: Mapped[int | None] = mapped_column(Integer)  # 1 도움돼요 / -1


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
