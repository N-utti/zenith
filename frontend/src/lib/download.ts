import { toastApi } from '@/components/ui/ToastContext'
import { apiBytes } from './api'
import { isDesktopShell } from './desktop'

/**
 * 바이트를 파일로 내려받게 한다. 앱의 모든 내려받기가 여기를 지난다.
 *
 * 데스크톱 앱(WebView2)은 다운로드 폴더에 조용히 저장하고 브라우저 같은 내려받기 표시를 띄우지
 * 않는다. 화면이 그대로라 사람들이 「안 받아진다」며 거듭 눌러 같은 파일이 여러 벌 쌓였다(#623).
 * ponytail: 저장 위치를 고르게 하려면 셸의 저장 대화상자가 필요하다(셸 권한을 여는 일이라 보류).
 */
export function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 클릭이 다운로드를 시작하기 전에 URL 을 거두면 일부 브라우저가 중단한다. 한 틱 미룬다.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  if (isDesktopShell()) toastApi.success(`다운로드 폴더에 저장했습니다: ${name}`)
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
