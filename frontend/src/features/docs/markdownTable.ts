/**
 * AI 가 "표로 정리" 로 돌려주는 초안에서 마크다운 표(`| a | b |` 줄과 `| --- |` 구분선)를 찾아
 * 행 배열로 푼다. 표가 없으면 null. 앞뒤에 안내 문장이 붙어 있어도 `|` 로 시작·끝나는 연속 구간만 본다.
 * 첫 줄이 머리글, 둘째 줄의 구분선은 버린다(FR-AI-09: 실제 표 블록으로 삽입).
 *
 * 열 수가 머리글과 다른 행이 있으면 표로 보지 않는다(null). 셀 안의 `\|` 는 안 다루는데,
 * 그런 표는 열 수가 어긋나 null 로 떨어져 텍스트로 들어간다. 조용히 깨진 표를 만들지 않는다.
 * 정렬 콜론(`:---:`)은 구분선으로 인정하되 정렬 자체는 버린다.
 */
export function parseMarkdownTable(text: string): string[][] | null {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
  const isRow = (l: string) => l.length > 1 && l.startsWith('|') && l.endsWith('|')
  const start = lines.findIndex(isRow)
  if (start < 0) return null
  const block: string[] = []
  for (let i = start; i < lines.length && isRow(lines[i]); i++) block.push(lines[i])
  if (block.length < 2) return null
  const rows = block.map((l) =>
    l
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim()),
  )
  if (!rows[1].every((c) => /^:?-+:?$/.test(c))) return null
  rows.splice(1, 1)
  const width = rows[0].length
  if (rows.some((r) => r.length !== width)) return null
  return rows
}

/**
 * 텍스트 자리에만 넣으므로 따옴표는 안 바꾼다. 속성 자리에 쓰게 되면 그때 추가.
 *
 * **`&` 를 먼저 바꾼다.** 안 그러면 `&lt;` 로 들어온 글자가 `<` 로 되살아나 태그가 된다.
 * 이 함수는 편집기에 심는 HTML 의 유일한 방어선이라 한 벌만 둔다(템플릿도 이걸 쓴다).
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 글을 편집기에 넣을 HTML 로 바꾼다. 빈 줄로 문단을, 줄바꿈으로 `<br>` 을 만들고 글자는 전부
 * 이스케이프한다.
 *
 * **AI 초안을 그대로 넣으면 안 된다.** 편집기는 넣는 문자열을 HTML 로 읽는다. AI 가 낸
 * `<img src="https://…">` 는 그림 블록이 되어 바깥 주소를 부르고(문서 내용을 주소에 실어 밖으로
 * 보낼 수 있다), 다른 태그는 문서 구조를 바꾼다. 백엔드가 짚은 것이다(#319).
 */
export function textToHtml(text: string): string {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** tiptap 표 확장이 그대로 읽는 HTML. 첫 행은 머리글 셀. */
export function tableToHtml(rows: string[][]): string {
  const tr = (cells: string[], tag: 'th' | 'td') =>
    `<tr>${cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
  const [head, ...body] = rows
  return `<table><tbody>${tr(head, 'th')}${body.map((r) => tr(r, 'td')).join('')}</tbody></table>`
}
