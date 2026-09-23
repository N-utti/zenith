/**
 * 본문의 `@이름` 멘션. 서버가 알림을 만드는 규칙(`realtime/chat.py` 의 `mention_targets`)과 같게
 * 자른다: `@` 뒤 공백 전까지, 끝에 붙은 문장부호(`.,!?:;)`)는 이름이 아니다.
 * 문서 댓글과 채팅이 같은 규칙을 쓴다.
 */
const MENTION = /@\S+/g
const TRAILING_PUNCT = /[.,!?:;)]+$/

export type MentionPart = { text: string; mention: boolean }

/** 본문을 평문과 멘션 조각으로 나눈다. 이어 붙이면 원문 그대로다. */
export function splitMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = []
  let last = 0
  for (const match of body.matchAll(MENTION)) {
    const token = match[0].replace(TRAILING_PUNCT, '')
    // `@` 하나나 `@.` 처럼 이름이 없으면 평문이다.
    if (token.length < 2) continue
    if (match.index > last) parts.push({ text: body.slice(last, match.index), mention: false })
    parts.push({ text: token, mention: true })
    last = match.index + token.length
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false })
  return parts
}

/**
 * 커서 바로 앞에서 치고 있는 `@질의`. 없으면 `null`.
 *
 * `@` 는 줄 처음이거나 공백 뒤여야 한다. 메일 주소(`a@b`)를 치는 중에 사람 목록이 뜨면 안 된다.
 * 한글 조합 중에도 입력칸 값에는 조합 중인 글자가 들어 있어 그대로 질의가 된다.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const match = /(^|\s)@(\S*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** `start` 의 `@` 부터 커서까지를 `@이름 ` 으로 바꾼다. 뒤에 공백이 이미 있으면 더 넣지 않는다. */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(caret)
  const head = `${text.slice(0, start)}@${name}`
  if (/^\s/.test(after)) return { text: head + after, caret: head.length + 1 }
  return { text: `${head} ${after}`, caret: head.length + 1 }
}
