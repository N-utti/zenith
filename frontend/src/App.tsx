import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { AppRoutes } from '@/app/routes'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { UpdateCard } from '@/components/layout/UpdateCard'
import { DesktopTitleBar } from '@/components/layout/WindowControls'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { isDesktopShell } from '@/lib/desktop'
import { queryClient } from '@/lib/queryClient'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 토스트는 라우터 밖에 둔다. 화면을 옮기면서 띄우는 알림(로그아웃 완료 등)이
          이동과 함께 사라지면 안 된다. */}
      <ToastProvider>
        <BrowserRouter>
          {/* 본문 바깥(명령 팔레트·상단바·사이드바·로그인 상태)이 터지는 경우의 마지막 그물.
              안쪽 바운더리가 먼저 잡으므로 여기까지 오면 셸이 죽은 것이라 새로고침만 남는다. */}
          <ErrorBoundary>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </ErrorBoundary>
        </BrowserRouter>
        {/* 데스크탑 앱의 새 버전 알림. 로그인 전 화면에서도, 본문이 터져도 떠야 해서 바깥에 둔다. */}
        <UpdateCard />
        {/* 셸은 창 틀이 없다. 앱이 터져도 창을 옮기고 닫을 수 있게 바깥에 둔다. */}
        {isDesktopShell() && <DesktopTitleBar />}
      </ToastProvider>
    </QueryClientProvider>
  )
}
