import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { meQueryKey } from '@/features/auth/queries'
import { ApiError } from './api'

/**
 * 서버가 세션을 끊으면(다른 곳에서 로그아웃 · 관리자 비활성화 · 비밀번호 변경) 어느 요청이든 401 이 온다.
 * 그 순간 프로필을 비워 익명으로 전이시킨다. 새로고침을 기다리지 않고 로그인 화면으로 간다.
 * refresh 가 가능한 만료(AUTH_EXPIRED)는 lib/api.ts 가 먼저 처리하므로 여기까지 오는 401 은 진짜 끝이다.
 */
function dropSessionOn401(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(meQueryKey, null)
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: dropSessionOn401 }),
  mutationCache: new MutationCache({ onError: dropSessionOn401 }),
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
