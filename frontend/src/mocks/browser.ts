import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

export async function startMockWorker() {
  await worker.start({
    onUnhandledRequest(request, print) {
      // WebSocket 핸드셰이크(/api/yjs, /api/ws)는 MSW 가 흉내 낼 대상이 아니다. vite 프록시가 받는다.
      // msw 2.x 는 이것도 여기로 넘기므로 빼지 않으면 문서를 열 때마다 오탐이 찍혀 진짜 누락을 가린다.
      if (request.headers.get('upgrade') === 'websocket') return
      // /api/* 가 MSW를 지나치면 vite 프록시가 없는 백엔드로 보내 조용히 죽는다.
      // 원인이 dev 서버 로그의 ECONNREFUSED로만 남아 화면에서는 추적이 안 되므로,
      // 핸들러 누락은 콘솔에서 바로 보이게 한다.
      if (new URL(request.url).pathname.startsWith('/api/')) {
        print.error()
        return
      }
      // 그 밖의 요청(에셋 등)은 원래대로 네트워크로 통과시킨다.
    },
    quiet: true,
  })

  // 시연판 데스크톱 앱에는 채팅·문서 릴레이 서버가 없다. 같은 코드를 화면 안에서 돌린다.
  if (import.meta.env.VITE_DEMO === 'true' && window.__TAURI__) {
    // 앱을 막 켰을 때 서비스 워커를 거친 첫 요청 하나가 실패한다(WebView2, 켤 때마다 재현).
    // 그게 화면 코드나 글꼴이면 빈 화면·섞인 글꼴이 되므로 버려도 되는 요청으로 먼저 받아 낸다.
    // 실패하지 않고 멈추는 PC 가 있어도 첫 화면을 막지 않게 시간 제한을 둔다.
    await fetch('/theme.js', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).catch(() => {})
    const { inlineRelayHandlers } = await import('./inlineRelay')
    worker.use(...inlineRelayHandlers())
  }
}
