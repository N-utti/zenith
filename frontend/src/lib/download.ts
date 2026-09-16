/**
 * 바이트를 파일로 내려받게 한다(근태 리포트 xlsx).
 * ponytail: 데스크톱 셸(Tauri)에서 a[download] 가 안 먹으면 그때 셸의 저장 대화상자로 옮긴다.
 */
export function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 클릭이 다운로드를 시작하기 전에 URL 을 거두면 일부 브라우저가 중단한다. 한 틱 미룬다.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
