import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

async function bootstrap() {
  // MSW는 첫 렌더 전에 반드시 준비돼야 한다. 아니면 /auth/me가 실제 네트워크로 새 나간다.
  // 조건을 여기에 그대로 적어야 프로덕션 빌드에서 msw 청크가 통째로 제거된다.
  if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_MSW !== 'true') {
    const { startMockWorker } = await import('./mocks/browser')
    await startMockWorker()
  }

  const container = document.getElementById('root')
  if (!container) throw new Error('#root 엘리먼트를 찾을 수 없습니다.')

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
