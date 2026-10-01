import { apiBytes } from './api'

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

/**
 * 서버의 파일을 받아 저장시킨다. `path` 는 `/api/` 로 시작하는 주소다(문서 파일 칩, 자료실).
 *
 * 링크를 그대로 따라가게 두지 않는다. 링크 이동은 로그인 만료 갱신을 타지 않고, 데스크탑
 * 셸에서는 오리진이 달라 `download` 의 파일 이름이 무시된다. 개발 중에는 목(서비스워커)이 이동
 * 요청을 건너뛰어 빈 파일이 저장된다.
 */
export async function downloadFromApi(path: string, name: string) {
  downloadBytes(name, await apiBytes(path.slice('/api'.length)), 'application/octet-stream')
}
