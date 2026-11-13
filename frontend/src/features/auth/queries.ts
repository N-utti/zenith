import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { User } from '@/types'

/** 로그아웃·프로필 갱신 등에서 무효화 대상으로 참조한다. */
export const meQueryKey = ['auth', 'me'] as const

/**
 * 프로필을 쿼리 밖에서 다시 받아 끼운다. 쿼리를 무효화해 다시 받게 하면 서버가 잠깐 502 를 준 것만으로
 * 쿼리가 오류가 되고 `AuthProvider` 가 익명으로 판정해 로그인 화면에 앉는다. 실패는 부른 쪽이 받는다.
 */
export async function reloadMe(qc: QueryClient): Promise<User> {
  const me = await api<User>('/me')
  qc.setQueryData(meQueryKey, me)
  return me
}
