/** 파일 크기를 사람이 읽는 단위로. 첨부 칩과 메시지 목록이 같은 것을 쓴다. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 보이는 이름과 받는 파일이 달라 보이게 만드는 글자: 제어 문자, 폭 없는 공백, 글자 방향 제어.
 * `lib/links.ts` 가 주소에서 빼는 것과 같은 집합이다.
 */
const HIDDEN = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu

/** 파일 이름에서 숨은 글자를 걷는다. 이름을 화면에 그리거나 저장 이름으로 쓰기 전에 거친다. */
export function cleanName(name: string): string {
  return name.replace(HIDDEN, '')
}

/**
 * 파일 이름을 몸통과 확장자로 가른다. 좁은 칸에서는 몸통만 말줄임하고 확장자는 늘 보여 준다.
 * 긴 이름 뒤에 숨은 `.bat` 이 말줄임에 가려지면 안 된다.
 */
export function splitExt(name: string): [stem: string, ext: string] {
  // 끝에 붙은 점·공백은 확장자가 아니다. Windows 는 저장할 때 떼므로 `a.exe.` 는 실행 파일이 된다.
  const dot = name.replace(/[. ]+$/, '').lastIndexOf('.')
  return dot > 0 && name.length - dot <= 12 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}
