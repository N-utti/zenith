import type { Schema } from '@/types'

/** 한 번에 받는 줄 수. 이만큼 차면 더 오래된 파일이 잘렸다는 뜻이라 화면이 알린다. */
export const ARCHIVE_LIMIT = 200

/**
 * 자료실 한 줄(`GET /archive`). 백엔드 `routers/archive.py` 의 `ArchiveFile`.
 *
 * 파일은 원래 자리에 그대로 있고 자료실은 모아 보여 주기만 한다. 그래서 `url` 은 원래 자리의
 * 주소 그대로고, 받을 수 있는지도 그 주소의 권한 판정이 정한다. 서버는 보는 사람이 받을 수
 * 있는 파일만 싣는다. 화면이 걸러서 숨기는 것이 아니다.
 *
 * - `source_id`·`source_title`: 채널 id 와 이름(DM 은 상대 이름) 또는 문서 id 와 제목.
 * - `scope`: `all` 은 로그인한 전원, `members` 는 그 채널 멤버만(비공개 채널·DM).
 */
export type ArchiveFile = Schema<'ArchiveFile'>

/** 파일이 붙어 있는 자리(`chat`·`doc`). */
export type ArchiveSource = ArchiveFile['source']
