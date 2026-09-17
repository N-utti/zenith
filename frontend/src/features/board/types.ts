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

export interface BoardPost {
  id: string
  boardId: string
  title: string
  /**
   * 05 SCR-05는 "작성부서"를 요구한다. 그런데 `users`에 부서가 없어(13번 A1)
   * 지금은 작성자 이름이 들어간다. 조직도가 생기면 부서로 바꾼다.
   */
  authorName: string
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
  /**
   * 수정·삭제 버튼을 띄울지 판단할 때만 쓴다. 차단은 서버의 403 이다.
   * 사람이 아닌 이름(경영지원팀)으로 올라간 글은 `null`.
   *
   * 백엔드는 이 자리를 `author: {id, name} | null` 객체로 준다(routers/boards.py `PostOut`).
   * 이 파일은 아직 `authorName` 평면 표기라 붙일 때 같이 옮긴다.
   */
  authorId: string | null
}
