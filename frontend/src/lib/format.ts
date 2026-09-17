/** 파일 크기를 사람이 읽는 단위로. 첨부 칩과 메시지 목록이 같은 것을 쓴다. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
