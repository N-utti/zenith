/** 채팅 `/ai` 커맨드의 답을 다는 시스템 계정 이름(백엔드 #400). 기다리는 동안 타이핑 줄에 이 이름이 뜬다. */
export const AI_NAME = 'AI 어시스턴트'

/** 서버(`chat_command.parse`)와 같은 판정: 앞뒤 공백을 빼고 `/ai` 이거나 `/ai ` 로 시작한다. */
export function isAiCommand(body: string) {
  const text = body.trim()
  return text === '/ai' || text.startsWith('/ai ')
}

/** 서버가 봇 답 끝에 빈 줄 하나를 두고 붙이는 근거 줄의 머리. */
const SOURCES = '\n\n근거: '

/**
 * 봇 답 끝의 「근거: [1] 제목 /docs/…」 줄. 맨몸 경로는 마크다운이 링크로 안 만들어서 링크 문법으로 감싼다.
 * 사내 문서·게시글 경로만 감싼다. 바깥 주소는 `AiMarkdown` 이 어차피 링크로 안 만든다.
 * 근거 줄만 건드린다. 답 본문의 코드 블록·링크 글자 안 경로까지 감싸면 마크다운이 깨진다.
 */
export function linkPaths(body: string) {
  const at = body.lastIndexOf(SOURCES)
  if (at < 0) return body
  const sources = body.slice(at).replace(/(^|\s)(\/(?:docs|board)\/[\w/-]+)/g, '$1[$2]($2)')
  return body.slice(0, at) + sources
}
