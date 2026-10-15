"""자료실 — 채팅·문서에 붙인 파일을 모아 본다(04 에 없는 경로, 이슈 #226 · README "설계와 어긋나는 것" 23).

파일은 원래 자리에 그대로 두고 **모아 보여 주기만** 한다 — `url` 은 원래 자리의 주소(`/api/channels/{id}/attachments/…`,
`/api/files/{id}`)라 받을 수 있는지는 그 주소의 판정(채널 멤버십·로그인)이 정하고, 여기는 보는 사람이 받을 수 있는 것만
싣는다(채팅 = 내가 멤버인 채널, 문서 = 로그인이면 전원). 자료실용 내려받기 경로를 따로 두면 판정이 두 벌이 된다.

채팅 쪽 자료는 `messages.attachments`(JSONB) — 올린 사람·시각은 그 메시지의 것. 문서 쪽은 `files` 기록부(#224) 중
`doc_id` 가 있고 그 문서가 살아 있는(휴지통·영구삭제 아님) 것.
ponytail: 문서 본문(Y.Doc)이 지금 참조하는 파일만 싣는 게 정확하지만 본문을 열어 주소를 긁어야 한다 — 올린 적 있는 파일
전부를 싣는다(잘못 올리고 칩을 지운 파일도 나온다). 필요해지면 yjs 릴레이가 저장하는 text_cache 에서 `/api/files/{id}` 를
뽑아 거른다. 검색(`q`)·다음 쪽(`next_cursor`)도 없다 — 200개가 차면 프론트가 「최근 200개까지만」을 띄운다.
"""

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import acl
from app.db import get_db
from app.deps import current_user
from app.models import Channel, ChannelMember, Document, Message, StoredFile, User
from app.routers.channels import Items, Person

router = APIRouter(tags=["archive"], dependencies=[Depends(current_user)])


class ArchiveFile(BaseModel):
    url: str  # 원래 자리의 주소 그대로 — 프론트는 이 두 모양만 내려받는다
    name: str
    size: int
    source: Literal["chat", "doc"]
    source_id: uuid.UUID  # 채널 id 또는 문서 id
    source_title: str  # 채널 이름(DM 은 상대 이름) 또는 문서 제목
    uploaded_by: Person
    created_at: datetime  # 채팅은 그 메시지의 시각
    scope: Literal[
        "all", "members"
    ]  # all = 로그인한 전원, members = 그 채널 멤버만(비공개·DM) 또는 등급 폴더의 문서


@router.get(
    "/archive",
    response_model=Items[ArchiveFile],
    summary="자료실 — 내가 받을 수 있는 채팅 첨부·문서 파일을 올린 지 최근 순으로(최대 200). 04 에 없던 경로",
)
async def list_archive(
    limit: int = Query(200, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Items[ArchiveFile]:
    items: list[ArchiveFile] = []
    # 채팅 — 내가 멤버인 채널의, 첨부가 붙은 메시지. 메시지 하나에 첨부가 여럿일 수 있어 limit 개 메시지면 충분하다
    rows = await db.execute(
        select(Message, User, Channel)
        .join(User, User.id == Message.author_id)
        .join(Channel, Channel.id == Message.channel_id)
        .join(
            ChannelMember,
            (ChannelMember.channel_id == Message.channel_id) & (ChannelMember.user_id == user.id),
        )
        # 첨부 없는 메시지는 chat.py 가 `attachments=None` 을 명시해 넣어 SQL NULL 이 아니라 JSON null 로 저장된다
        # (JSONB 기본 none_as_null=False) — IS NOT NULL 로는 못 거른다. 배열인 행만.
        .where(func.jsonb_typeof(Message.attachments) == "array")
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
    )
    chat_rows = rows.all()
    dm_ids = {c.id for _, _, c in chat_rows if c.is_dm}
    peers: dict[uuid.UUID, str] = {}
    if dm_ids:  # DM 이름은 상대 이름 — 채널당 한 번(search.py 와 같은 방식)
        for cid, name in await db.execute(
            select(ChannelMember.channel_id, User.name)
            .join(User, User.id == ChannelMember.user_id)
            .where(ChannelMember.channel_id.in_(dm_ids), User.id != user.id)
            .order_by(ChannelMember.channel_id, User.name)
        ):
            peers.setdefault(cid, name)
    for msg, author, channel in chat_rows:
        for a in msg.attachments or ():
            items.append(
                ArchiveFile(
                    url=a["url"],
                    name=a["name"],
                    size=a["size"],
                    source="chat",
                    source_id=channel.id,
                    source_title=peers.get(channel.id, "") if channel.is_dm else channel.name,
                    uploaded_by=Person.model_validate(author),
                    created_at=msg.created_at,
                    scope="members" if channel.is_dm or channel.is_private else "all",
                )
            )
    # 문서 — 기록부에 doc_id 가 있고 문서가 살아 있는 것, 그리고 내가 볼 수 있는 폴더의 것(README 57)
    doc_rows = await db.execute(
        select(StoredFile, User, Document.title, Document.folder_id)
        .join(User, User.id == StoredFile.uploader_id)
        .join(Document, Document.id == StoredFile.doc_id)
        .where(Document.deleted_at.is_(None), Document.folder_id.in_(acl.visible_folder_ids(user)))
        .order_by(StoredFile.created_at.desc(), StoredFile.id.desc())
        .limit(limit)
    )
    restricted = set(await db.scalars(acl.restricted_folder_ids()))  # 조상 등급까지(README 57)
    for f, uploader, title, folder_id in doc_rows:
        items.append(
            ArchiveFile(
                url=f"/api/files/{f.id}",
                name=f.name,
                size=f.size,
                source="doc",
                source_id=f.doc_id,
                source_title=title,
                uploaded_by=Person.model_validate(uploader),
                created_at=f.created_at,
                scope="members" if folder_id in restricted else "all",
            )
        )
    items.sort(key=lambda i: i.created_at, reverse=True)
    return Items(items=items[:limit])
