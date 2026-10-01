/**
 * 평문 속 주소를 누를 수 있는 링크로 바꾸기 위한 순수 함수들. 채팅 메시지와 문서 댓글이 쓴다
 * (`features/people/MentionText.tsx`).
 *
 * `http://`·`https://` 로 시작하는 것만 주소로 본다. `javascript:` 같은 것은 정규식에서 걸리지
 * 않아 평문으로 남는다. 본문은 믿을 수 없는 입력이라 이 허용 목록이 XSS 방어다.
 *
 * 한글은 주소에 넣지 않는다. "https://a.com/x를 봐 주세요" 처럼 조사를 붙여 쓰는 일이 흔하고,
 * 브라우저 주소창에서 복사한 주소는 한글이 %XX 로 바뀌어 있어 잘리지 않는다.
 *
 * 폭 없는 공백(U+200B~200F)과 글자 방향 제어 문자(U+202A~202E, U+2066~2069)도 넣지 않는다.
 * 화면에 보이는 주소와 실제 주소가 달라 보이게 만드는 데 쓰인다.
 */
const LINK = /https?:\/\/[^\s<>"ㄱ-ㆎ가-힣\u200B-\u200F\u202A-\u202E\u2066-\u2069]+/g
const TRAILING_PUNCT = ".,!?:;)]'’”"
const OPENER: Record<string, string> = { ')': '(', ']': '[' }

const count = (text: string, char: string) => text.split(char).length - 1

/**
 * 문장 끝에 붙은 부호를 뗀다. "(https://a.com)." 의 닫는 괄호와 마침표는 주소가 아니다.
 *
 * 닫는 괄호는 주소 안에 짝이 있으면 남긴다(`…/wiki/Foo_(bar)`). 정규식(`[…]+$`)으로 떼지 않고
 * 괄호 수도 한 번만 센다. 부호가 길게 이어진 본문에서 제곱 시간이 걸리지 않게 하려는 것이다.
 */
function trimTrailing(href: string): string {
  const closes: Record<string, number> = { ')': count(href, ')'), ']': count(href, ']') }
  const opens: Record<string, number> = { ')': count(href, '('), ']': count(href, '[') }
  let end = href.length
  while (end > 0 && TRAILING_PUNCT.includes(href[end - 1])) {
    const char = href[end - 1]
    if (OPENER[char]) {
      if (opens[char] >= closes[char]) break
      closes[char] -= 1
    }
    end -= 1
  }
  return href.slice(0, end)
}

export type LinkPart = { text: string; href?: string }

/** 평문을 글과 주소 조각으로 나눈다. 이어 붙이면 원문 그대로다. */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const href = trimTrailing(match[0])
    // "https://" 뒤가 부호뿐이면 주소가 아니다.
    if (!/^https?:\/\/[^/]/.test(href)) continue
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: href, href })
    last = match.index + href.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/**
 * 제니스 안을 가리키는 주소면 앱 안 경로(`/docs/…`)를, 바깥 주소면 `null` 을 준다.
 *
 * 안쪽 주소는 새 탭이 아니라 라우터로 옮긴다. 데스크탑 셸에서는 화면 오리진이
 * `tauri://localhost` 라 동료가 브라우저에서 복사한 주소(서버 오리진)와 다르다. 그래서 서버
 * 오리진도 안쪽으로 친다. `/api` 는 화면이 아니라 서버 경로라 바깥으로 둔다(파일 내려받기 등).
 */
export function internalPath(href: string, origins: readonly string[]): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!origins.includes(url.origin)) return null
  // `//evil.com/…` 로 시작하는 경로는 라우터가 다른 호스트의 주소로 읽는다. 그대로 넘기면
  // 제니스 주소로 보이는 링크가 같은 탭에서 바깥으로 나간다(`https://제니스//evil.com`,
  // 백슬래시도 URL 파서가 슬래시로 바꾼다). 바깥 링크로 돌려 보이는 주소 그대로 열게 한다.
  if (url.pathname.startsWith('//')) return null
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null
  return url.pathname + url.search + url.hash
}

/**
 * 앱 안 경로가 문서 하나(`/docs/{id}`)를 가리키면 그 id. 목록(`/docs`)과 휴지통은 아니다.
 * 뒤에 경로가 더 붙어도(`/docs/{id}/x`) 아니다. 문서 화면에 닿지 않는 주소다.
 */
export function docIdOf(path: string): string | null {
  const id = /^\/docs\/([^/?#]+)\/?(?:[?#]|$)/.exec(path)?.[1]
  return id && id !== 'trash' ? id : null
}

/**
 * 올린 파일의 경로(`/api/files/{id}`)면 그대로, 아니면 `null`.
 *
 * 문서 파일 칩의 `src` 는 붙여넣은 HTML 이나 다른 사람의 편집(Y.Doc)에서도 온다. 거르지 않으면
 * `javascript:` 나 바깥 주소가 내려받기 링크로 둔갑한다.
 */
export function uploadedFilePath(src: unknown): string | null {
  return typeof src === 'string' && /^\/api\/files\/[\w-]+$/.test(src) ? src : null
}
