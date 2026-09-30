/**
 * CSV 를 행·칸으로 나눈다(RFC 4180). 따옴표 안의 쉼표·줄바꿈·겹따옴표("")를 지원한다.
 * 빈 행도 그대로 둔다. 행 순번이 엑셀의 행 번호와 같아야 미리보기의 줄 번호로 찾아갈 수 있다.
 * 따옴표는 칸 첫 글자일 때만 감싸기로 본다. 짝이 안 맞으면 null(파일 뒷부분을 한 칸으로 삼키지 않게).
 */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (src[i + 1] === '"') cell += src[++i]
      else quoted = false
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (quoted) return null
  row.push(cell)
  rows.push(row)
  return rows
}

/**
 * 파일 바이트를 글자로. UTF-8 이 아니면 CP949 로 읽는다. 한글 윈도우 엑셀의 「CSV(쉼표로 분리)」
 * 저장은 CP949 다(「CSV UTF-8」 을 따로 골라야 UTF-8).
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}
