import type { Role } from '@/types'

export interface Board {
  id: string
  name: string
  /** 이 등급 이상만 열람·작성. 서버가 `allowed`로 판정해 내려준다. */
  minRole: Role
  /** 사이드바·목록에 붙는 짧은 표기. 전체 / 팀장↑ / 임원 */
  badge: string
  allowed: boolean
}

/** 백엔드 `PostCreateIn`·`PostPatchIn` 의 제약(`openapi.json`). 폼과 목이 같은 값을 본다. */
export const TITLE_MAX = 200
export const BODY_MAX = 20_000

/** 백엔드 `routers/boards.py` 의 `Person`. */
export interface Person {
  id: string
  name: string
}

export interface BoardPost {
  id: string
  boardId: string
  title: string
  /**
   * 글쓴이. 권한 밖이라 마스킹된 행은 서버가 `null` 로 내린다(이름조차 주지 않는다).
   *
   * 05 SCR-05는 "작성부서"를 요구하지만 `users`에 부서가 없어(13번 A1) 지금은 사람 이름이다.
   * 조직도가 생기면 부서로 바꾼다.
   */
  author: Person | null
  createdAt: string
  pinned: boolean
  /**
   * 권한 밖 글. **목록에서 지우지 않고 제목을 가린 채 남긴다**.
   * PRD 성공 기준이 "제목 마스킹 + 본문 API 403"이다.
   */
  masked?: boolean
}

export interface BoardPostDetail extends BoardPost {
  body: string
}
