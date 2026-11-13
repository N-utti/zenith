import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { meQueryKey, reloadMe } from '@/features/auth/queries'
import { ApiError } from './api'
import { clearNotifications } from './desktop'

/**
 * 서버가 세션을 끊으면(다른 곳에서 로그아웃 · 관리자 비활성화 · 비밀번호 변경) 어느 요청이든 401 이 온다.
 * 그 순간 프로필을 비워 익명으로 전이시킨다. 새로고침을 기다리지 않고 로그인 화면으로 간다.
 * refresh 가 가능한 만료(AUTH_EXPIRED)는 lib/api.ts 가 먼저 처리하므로 여기까지 오는 401 은 진짜 끝이다.
 */
function dropSessionOn401(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(meQueryKey, null)
    // 로그인 화면에 앉아 있는 동안 알림 센터로 앞사람의 DM 을 읽지 않게 한다. 나머지는 다음 로그인이 비운다.
    clearNotifications()
  }
  // 같은 브라우저의 다른 탭에서 임시 비밀번호로 다시 로그인해 쿠키가 바뀐 경우(백엔드 #601). 이 탭의
  // 프로필은 아직 표시가 꺼져 있어 앱이 떠 있다. 다시 받으면 `RequireAuth` 가 변경 화면으로 바꾼다.
  // ponytail: 한꺼번에 실패한 요청 수만큼 `/me` 를 부른다. 드문 경우라 묶지 않는다.
  if (error instanceof ApiError && error.code === 'PASSWORD_CHANGE_REQUIRED') {
    reloadMe(queryClient).catch(() => undefined)
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
