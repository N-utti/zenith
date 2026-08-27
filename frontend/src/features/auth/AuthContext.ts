import { createContext, use } from 'react'
import type { User } from '@/types'

export interface AuthValue {
  user: User | null
  status: 'loading' | 'authenticated' | 'anonymous'
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth는 <AuthProvider> 안에서만 쓸 수 있습니다.')
  return value
}

/** 로그인 이후 화면에서만 쓴다. user가 null이면 라우팅이 잘못된 것이므로 던진다. */
export function useCurrentUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('인증된 사용자가 없습니다.')
  return user
}
