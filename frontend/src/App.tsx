import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { AppRoutes } from '@/app/routes'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { queryClient } from '@/lib/queryClient'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 토스트는 라우터 밖에 둔다. 화면을 옮기면서 띄우는 알림(로그아웃 완료 등)이
          이동과 함께 사라지면 안 된다. */}
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
