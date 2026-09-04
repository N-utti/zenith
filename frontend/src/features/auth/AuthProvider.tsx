import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    retry: false,
    staleTime: Infinity,
  })

  const login = useCallback(
    async (email: string, password: string) => {
      // 04 §1: 204 + Set-Cookie. 본문에 토큰이 없으므로 프로필은 서버에 다시 묻는다.
      await api<void>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
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
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
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
