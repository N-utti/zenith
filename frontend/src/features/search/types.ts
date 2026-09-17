/**
 * ⌘K 통합검색 결과 한 줄. 백엔드 `routers/search.py` 의 `Hit` 과 같은 모양이다.
 *
 * 권한 밖은 마스킹이 아니라 **결과에서 빠진다**. 검색은 존재 자체가 새면 안 되기 때문이다.
 * 그래서 프론트에는 가릴 것이 없다.
 */
export interface SearchHit {
  type: 'doc' | 'chat' | 'post'
  id: string
  /** 문서 제목 · 채팅은 보낸 사람 이름 · 게시글 제목 */
  title: string
  /** 문서=폴더, 채팅=#채널 또는 DM, 게시글=게시판 */
  sub: string
  /**
   * 일치 부분을 `**…**` 로 감싼 평문. 서버가 `<>&` 를 이스케이프해 보낸다.
   * HTML 로 그리면 안 된다. 글자로 그리고 `**` 만 파싱한다.
   */
  snippet: string
  /** 프론트 라우트. 서버가 만들어 준다. */
  to: string
  /** 최근성 근거. "3일 전" 을 그린다. */
  at: string
}

export const SEARCH_TYPE_LABEL: Record<SearchHit['type'], string> = {
  doc: '문서',
  chat: '채팅',
  post: '게시글',
}
