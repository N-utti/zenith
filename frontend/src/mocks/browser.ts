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
}
