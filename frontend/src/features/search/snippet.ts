/**
 * 서버가 준 스니펫을 조각으로 나눈다. 일치 부분은 `**…**` 로 감싸여 온다.
 *
 * **HTML 로 그리지 않는다.** 서버가 `<>&` 를 이스케이프해 보내지만(TC-SEC-04), 그건
 * 본문에 든 태그 조각이 새지 않게 하는 안전망이지 HTML 로 그리라는 뜻이 아니다.
 * 여기서 글자 조각으로 나누고 화면이 React 노드로 그린다.
 *
 * 짝이 맞지 않는 `**` 는 강조가 아니라 글자 그대로 남긴다. 스니펫은 본문을 자른 것이라
 * 마커가 반쪽만 들어오는 일이 생긴다.
 */
export interface SnippetPart {
  text: string
  hit: boolean
}

/**
 * 서버가 `<>&` 를 엔티티로 바꿔 보낸다(`_snippet` 의 `escape`). 본문에 든 태그 조각이
 * 새지 않게 하는 안전망인데, 우리는 HTML 이 아니라 글자로 그리므로 여기서 되돌린다.
 * 안 되돌리면 본문의 `A&B` 가 화면에 `A&amp;B` 로 보인다.
 *
 * `&amp;` 를 **마지막에** 푼다. 먼저 풀면 `&amp;lt;` 가 `<` 로 잘못 접힌다.
 */
function unescape(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

export function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let rest = snippet

  while (rest.length > 0) {
    const open = rest.indexOf('**')
    if (open === -1) break
    const close = rest.indexOf('**', open + 2)
    if (close === -1) break

    if (open > 0) parts.push({ text: unescape(rest.slice(0, open)), hit: false })
    const inner = rest.slice(open + 2, close)
    // `****` 처럼 빈 강조는 버린다. 빈 마크는 화면에 아무것도 안 그리면서 자리만 차지한다.
    if (inner) parts.push({ text: unescape(inner), hit: true })
    rest = rest.slice(close + 2)
  }

  if (rest) parts.push({ text: unescape(rest), hit: false })
  return parts
}
