import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { api } from '@/lib/api'
import type { Schema } from '@/types'

/** 백엔드 `routers/people.py` 의 `Person`. 이메일은 주지 않는다. `team` 은 소속이 없으면 `null`. */
export type Colleague = Schema<'PersonOut'>

/**
 * 고를 수 있는 사람만 남긴다. 서버는 이름순으로, **자기 자신과 비활성 계정까지** 준다.
 *
 * 비활성을 남겨 두면 고를 수 있게 보이고 보낸 뒤에야 422 로 알게 된다.
 */
export function pickable(people: Colleague[], meId: string): Colleague[] {
  return people.filter((person) => person.active && person.id !== meId)
}

/**
 * 임원과 사원으로 가른다. 등급은 사원·임원 두 단이라 `lead` 도 사원 쪽이다.
 */
export function byTier(people: Colleague[]): { label: '임원' | '사원'; people: Colleague[] }[] {
  return [
    { label: '임원' as const, people: people.filter((person) => person.role === 'exec') },
    { label: '사원' as const, people: people.filter((person) => person.role !== 'exec') },
  ].filter((group) => group.people.length > 0)
}

/**
 * 사람을 고르는 자리(새 대화·결재 참조자·위임 대상)가 쓰는 명단.
 *
 * 전에는 내가 속한 채널의 멤버를 긁었다(계정 목록 `/admin/users` 가 임원 전용이라 그게
 * 유일한 길이었다). 그래서 **DM 만 주고받는 사람이 빠졌고**, 활성 여부를 몰라 비활성
 * 계정을 고르면 422 를 맞았다. 백엔드 `GET /people`(#117)이 둘 다 닫는다.
 *
 * 명단·근무 상태 같은 표시용 자리는 여전히 채널 멤버를 쓴다 — 그쪽은 고르는 자리가 아니다.
 */
export function useColleagues(): { people: Colleague[]; isPending: boolean; isError: boolean } {
  const me = useCurrentUser()
  const { data, isPending, isError } = useQuery({
    queryKey: ['people'],
    queryFn: () => api<{ items: Colleague[] }>('/people'),
  })

  return { people: pickable(data?.items ?? [], me.id), isPending, isError }
}

/** 멘션 배지를 칠할 이름: 활성 동료 전체 + 나(명단은 나를 빼고 준다. 남이 나를 부른 글). */
export function useMentionNames(): ReadonlySet<string> {
  const user = useCurrentUser()
  const { people } = useColleagues()
  return useMemo(
    () => new Set([...people.map((person) => person.name), user.name]),
    [people, user.name],
  )
}
