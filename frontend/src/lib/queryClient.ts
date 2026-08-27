import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // 인증·권한 실패는 재시도해도 결과가 같다.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})
