import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

export async function startMockWorker() {
  await worker.start({
    // 핸들러가 없는 요청(에셋 등)은 그대로 네트워크로 보낸다.
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
}
