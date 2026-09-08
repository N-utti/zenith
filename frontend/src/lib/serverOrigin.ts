/**
 * 앱이 붙을 서버 오리진.
 *
 * 브라우저에서는 빈 문자열이다. 같은 오리진으로 내보내면 개발에서는 vite 프록시가,
 * 운영에서는 역방향 프록시가 받는다. 지금까지의 동작 그대로다.
 *
 * 데스크탑 셸(Tauri)은 다르다. 화면이 `tauri://localhost`에서 뜨므로 `/api`로 보낸
 * 요청이 사내 서버가 아니라 셸 자신에게 간다. 그래서 셸 빌드는 서버 주소를 명시해야 한다.
 *
 *   1) localStorage `zenith.serverOrigin`. 설치 후 현장에서 서버를 옮겼을 때의 탈출구
 *   2) 빌드 시 `VITE_SERVER_ORIGIN`     . 사내 배포본에 박아 두는 기본값
 *   3) 둘 다 없으면 같은 오리진 (= 브라우저 동작)
 */

const OVERRIDE_KEY = 'zenith.serverOrigin'

function normalize(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().replace(/\/+$/, '')
}

/** 오리진은 한 세션 안에서 바뀌지 않는다. 매 요청마다 localStorage를 읽을 이유가 없다. */
let cached: string | null = null

export function serverOrigin(): string {
  if (cached !== null) return cached

  let override = ''
  try {
    override = normalize(localStorage.getItem(OVERRIDE_KEY))
  } catch {
    // 저장소 접근이 막힌 환경(프라이빗 모드 등)에서는 빌드 기본값만 쓴다.
  }

  cached = override || normalize(import.meta.env.VITE_SERVER_ORIGIN)
  return cached
}

/** REST 경로를 실제 요청 URL로. 오리진이 비면 지금까지처럼 상대경로가 나간다. */
export function httpUrl(path: string): string {
  return `${serverOrigin()}${path}`
}

/**
 * WebSocket URL. 오리진이 비어 있으면 지금 페이지의 오리진을 쓴다.
 * `location.host`를 직접 조립하던 자리를 이 함수가 대신한다.
 */
export function wsUrl(path: string): string {
  const base = serverOrigin() || location.origin
  return `${base.replace(/^http/, 'ws')}${path}`
}
