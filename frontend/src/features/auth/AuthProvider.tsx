import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { clearToken, getToken, setToken } from '@/lib/token'
import type { LoginResponse, User } from '@/types'
import { AuthContext, type AuthValue } from './AuthContext'
import { meQueryKey } from './queries'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: meQueryKey,
    queryFn: () => api<User>('/auth/me'),
    enabled: getToken() !== null,
    retry: false,
    staleTime: Infinity,
  })

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setToken(res.token)
      qc.setQueryData(meQueryKey, res.user)
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
    clearToken()
    qc.clear()
  }, [qc])

  const value = useMemo<AuthValue>(() => {
    const hasToken = getToken() !== null
    const status: AuthValue['status'] = !hasToken
      ? 'anonymous'
      : isPending
        ? 'loading'
        : isError || !data
          ? 'anonymous'
          : 'authenticated'

    return { user: status === 'authenticated' ? (data ?? null) : null, status, login, logout }
  }, [data, isPending, isError, login, logout])

  return <AuthContext value={value}>{children}</AuthContext>
}
