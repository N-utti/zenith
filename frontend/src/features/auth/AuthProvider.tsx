import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { resetThread } from '@/features/ai/store'
import { clearDrafts } from '@/features/chat/drafts'
import { api, ApiError } from '@/lib/api'
import type { User } from '@/types'
import { AuthContext, type AuthValue } from './AuthContext'
import { meQueryKey } from './queries'

/** 세션은 HttpOnly 쿠키라 JS 가 "로그인했는지" 미리 알 수 없다. 서버에 묻고, 401 이면 익명이다(11 §10.2). */
async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>('/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/**
 * 앞사람이 이 탭에 남긴 것을 버린다: 서버에서 받아 둔 쿼리 캐시(프로필 제외), AI 대화, 쓰다 만 채팅 글.
 * 결재 본문·가려지기 전 게시글 제목·AI 근거 인용문처럼 등급마다 다른 내용이 섞여 있다.
 */
function forgetPreviousUser(qc: QueryClient) {
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
  resetThread()
  clearDrafts()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    // 401 은 fetchMe 가 null 로 바꾸므로 여기 오는 오류는 서버 응답이 아닌 것(네트워크 등)뿐이다.
    // 부팅 때 한 번 삐끗했다고 로그인 화면으로 보내지 않는다.
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
    staleTime: Infinity,
  })

  const login = useCallback(
    async (email: string, password: string) => {
      // 04 §1: 204 + Set-Cookie. 본문에 토큰이 없으므로 프로필은 서버에 다시 묻는다.
      await api<void>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      // 세션 만료(`queryClient`)로 온 로그인 화면은 프로필만 비웠을 뿐 앞사람 캐시를 그대로 들고 있다.
      // 그래서 로그아웃과 별개로 들어오는 쪽에서도 비운다. 로그인 화면에는 구독 중인 화면이 없어 안전하다.
      forgetPreviousUser(qc)
      qc.setQueryData(meQueryKey, await api<User>('/me'))
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' })
    } catch (error) {
      // 세션이 이미 죽었어도 로컬 정리는 끝까지 진행한다.
      if (!(error instanceof ApiError)) throw error
    }
    // 프로필을 먼저 null 로 바꿔야 구독 중인 화면이 익명으로 전이해 로그인 화면으로 간다.
    // qc.clear() 로 쿼리를 통째로 지우면 구독자는 옛 쿼리를 붙든 채 다시 그려지지 않는다.
    qc.setQueryData(meQueryKey, null)
    // AI 대화를 비우면 받고 있던 답변 스트림도 다음 조각에서 닫힌다(`useAsk`).
    forgetPreviousUser(qc)
  }, [qc])

  const value = useMemo<AuthValue>(() => {
    const status: AuthValue['status'] = isPending
      ? 'loading'
      : isError || !data
        ? 'anonymous'
        : 'authenticated'

    return { user: status === 'authenticated' ? (data ?? null) : null, status, login, logout }
  }, [data, isPending, isError, login, logout])

  return <AuthContext value={value}>{children}</AuthContext>
}
