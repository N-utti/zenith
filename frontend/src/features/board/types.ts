import type { Role, Schema } from '@/types'

/**
 * 게시판 목록·홈 공지에 붙는 짧은 표기. `min_role` 하나로 만든다.
 *
 * 홈 한 벌의 공지에는 게시판 목록이 따로 오지 않아, 등급에서 바로 뽑아야 한다.
 */
export const BOARD_BADGE: Record<Role, string> = {
  member: '전체',
  lead: '팀장↑',
  exec: '임원',
}

/**
 * 백엔드 `BoardOut`. `allowed` 는 이 등급 이상만 열람·작성할 수 있는지를 서버가 판정해 내려준 값이다.
 * 짧은 표기(전체 / 팀장↑ / 임원)는 서버가 주지 않아 `BOARD_BADGE[min_role]` 로 그린다.
 * 서버는 `min_role` 을 문자열로만 알려 줘서 등급 셋으로 좁혀 둔다.
 */
export type Board = Omit<Schema<'BoardOut'>, 'min_role'> & { min_role: Role }

/** 백엔드 `PostCreateIn`·`PostPatchIn` 의 제약(`openapi.json`). 폼과 목이 같은 값을 본다. */
export const TITLE_MAX = 200
export const BODY_MAX = 20_000

/** 백엔드 `routers/boards.py` 의 `Person`. */
export type Person = Schema<'Person'>

/**
 * 게시판 목록의 글. 백엔드 `PostOut`(홈 공지 카드의 `HomePost` 와 같은 모양).
 *
 * `author` 는 글쓴이다. 권한 밖이라 마스킹된 행은 서버가 `null` 로 내린다(이름조차 주지 않는다).
 * 05 SCR-05는 "작성부서"를 요구하지만 `users`에 부서가 없어(13번 A1) 지금은 사람 이름이다.
 * 조직도가 생기면 부서로 바꾼다.
 *
 * `masked` 는 권한 밖 글이다. **목록에서 지우지 않고 제목을 가린 채 남긴다**.
 * PRD 성공 기준이 "제목 마스킹 + 본문 API 403"이다.
 */
export type BoardPost = Omit<Schema<'PostOut'>, 'min_role'> & {
  min_role: Role
  /** 목만 싣는 고정 표시. 서버에는 `pinned` 컬럼이 없다(backend/README "설계와 어긋나는 것" 14 (g)). */
  pinned?: boolean
}

export type BoardPostDetail = BoardPost & Pick<Schema<'PostDetail'>, 'body'>

/**
 * 게시글 댓글. 서버에는 아직 없다(프론트가 먼저 만들었다, `api.ts` 의 `POST_COMMENTS_ENABLED`).
 * 문서 댓글(`CommentOut`)에서 블록 칸을 뺀 모양으로 가정했다.
 */
export interface PostComment {
  id: string
  author: Person
  body: string
  created_at: string
  /** 고친 시각. 고친 적이 없으면 `null`. */
  edited_at: string | null
}

/** 댓글 글자 수 상한. 문서 댓글(`CommentCreateIn.body`)과 같게 잡았다. */
export const POST_COMMENT_MAX = 10_000
