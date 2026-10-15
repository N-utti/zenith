/** AI 가 고칠 수 있는 첨부(백엔드 #401). 서버도 확장자로 가른다. 나머지 형식은 메뉴를 안 단다. */
export function canEdit(name: string) {
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  return ext === 'xlsx' || ext === 'docx'
}

/**
 * 엑셀 칸에 들어갈 값이 수식인지. 결과는 Excel 이 열 때 다시 계산하므로 표에서 따로 짚는다.
 * 워드 문단은 `=` 로 시작해도 글자다.
 */
export function isFormula(name: string, after: string) {
  return name.toLowerCase().endsWith('.xlsx') && after.startsWith('=')
}
