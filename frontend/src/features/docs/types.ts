import type { Schema } from '@/types'

/** 백엔드 `routers/docs.py` 의 `Person`. */
export type Person = Schema<'Person'>

/**
 * 폴더. 백엔드 `FolderOut` 과 같은 모양이다.
 *
 * 문서는 문서 안에 들어가지 않는다. **폴더가 폴더를 담고, 문서는 폴더에만 담긴다.**
 * 이전에는 문서끼리 `parentId` 로 겹쳐 두었는데 서버에는 그런 관계가 없다.
 * `sort` 는 같은 부모 안에서의 순서다. 작은 것이 위.
 */
export type Folder = Schema<'FolderOut'>

/**
 * 백엔드 `DocOut`. `updated_by` 는 마지막으로 손댄 사람이고 계정이 지워졌으면 `null`,
 * `deleted_at` 은 휴지통에 들어간 시각이고 살아 있는 문서는 `null` 이다.
 */
export type DocSummary = Schema<'DocOut'>

/** 사이드바 트리 한 벌(`GET /tree`). 폴더와 문서를 따로 준다. */
export type DocTreeData = Schema<'TreeOut'>

/** 업로드 결과. 문서에는 바이너리가 아니라 이 url만 들어간다. */
export type UploadedFile = Schema<'FileOut'>

/**
 * 블록 댓글. 백엔드 `CommentOut` 과 같은 모양이다.
 *
 * 아바타 색은 서버가 주지 않는다. `lib/avatar.ts` 가 사람 id 로 만든다(다른 화면과 같은 규약).
 * `block_id` 는 본문 어느 블록에 달렸는지다. 문서 전체에 단 댓글은 `null` 이다.
 */
export type DocComment = Schema<'CommentOut'>

/** 백엔드 `CommentCreateIn.body` 의 max_length. 최소 한 글자는 있어야 한다. */
export const COMMENT_BODY_MAX = 10_000

/** 블록 id 길이 상한(백엔드 `BlockId`). 공백을 턴 뒤 1~100자다. */
export const BLOCK_ID_MAX = 100

/** 서버가 휴지통 문서를 들고 있는 기간(백엔드 `TRASH_RETENTION`). 지나면 서버가 지운다. */
export const TRASH_KEEP_DAYS = 30

/**
 * 영구 삭제 예정 시각. 휴지통 화면의 "n일 남음" 과 문서 화면의 "10월 17일에 삭제" 가 같은
 * 계산을 봐야 한다. 두 벌로 두면 백엔드가 기간을 바꿨을 때 한쪽만 고치고 다른 쪽이 거짓말한다.
 */
export function purgeAt(deletedAt: string): Date {
  const at = new Date(deletedAt)
  at.setDate(at.getDate() + TRASH_KEEP_DAYS)
  return at
}

/**
 * 버전 목록에 실리는 것. 백엔드 `VersionMeta` 와 같다.
 *
 * **스냅샷이 없다.** 한 건은 작아도 버전이 쌓인 문서에서는 목록 한 번에 전부 실리기 때문이다
 * (`backend/app/routers/docs.py` 의 `VersionOut` 주석). 내용은 `POST /docs/{id}/restore` 로
 * 그 버전 하나만 받는다.
 *
 * `author` 는 계정이 지워졌으면 `null`. `label` 은 되돌리기처럼 이유가 분명한 버전에만 붙고,
 * 붙으면 병합되지 않는다.
 */
export type DocVersion = Schema<'VersionMeta'>

/**
 * 스냅샷까지 실린 버전. 백엔드 `VersionOut`(버전 저장과 `/restore` 의 응답).
 * `snapshot` 은 Yjs 스냅샷(base64)이다. 내용 사본이 아니라 시점 표식이다.
 */
export type DocVersionSnapshot = Schema<'VersionOut'>

/**
 * 백엔드 `DocDetail`. `ydoc` 은 서버가 보관한 Yjs 상태(base64)이고 아직 릴레이가 영속화하기
 * 전이면 `null` 이다. 지금 화면은 읽지 않는다. 본문 연동을 붙일 때 `seedHtml` 대신 이쪽을 쓴다.
 */
export type DocDetail = Schema<'DocDetail'> & {
  /**
   * 이 문서를 처음 여는 탭에서만 쓰는 초안.
   *
   * 본문의 원천은 Y.Doc이고 서버는 목록용 메타만 들고 있다. 실제 백엔드에서는
   * 서버가 보관한 Yjs 초기 상태가 이 자리를 대신하므로 이 필드는 사라진다.
   */
  seedHtml?: string
}

/**
 * 새 문서를 열며 `navigate('/docs/:id', { state })` 로 실어 보내는 초안. AI 답변 "문서로 저장"이 쓴다.
 * 서버 `POST /docs` 가 본문을 받지 않아(backend/README §3 (d)) 초안은 브라우저가 Y.Doc 에 심는다.
 */
export interface DocSeedState {
  seedHtml: string
  title: string
}
