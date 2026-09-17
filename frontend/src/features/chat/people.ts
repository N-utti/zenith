import { useMemo } from 'react'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useChannels } from './api'
import type { Person } from './types'

/**
 * 나와 채널을 같이 쓰는 사람들. 이름순, 나는 뺀다.
 *
 * **사원이 볼 수 있는 사용자 목록이 서버에 없다.** 계정 목록(`/admin/users`)은 임원 전용이라,
 * 채널 멤버가 지금 프론트가 사람을 알 수 있는 유일한 길이다. 공개 채널에 활성 사용자가 전원
 * 들어가므로(백엔드 `join_public_channels`) 실제로는 전 직원이 모인다.
 *
 * DM 만 주고받는 사람이 생기면 그 사람은 여기 안 나온다. 백엔드에 사원용 목록을 요청해 뒀다.
 */
export function useColleagues(): { people: Person[]; isPending: boolean } {
  const me = useCurrentUser()
  const { data, isPending } = useChannels()

  const people = useMemo(() => {
    const byId = new Map<string, Person>()
    for (const channel of data?.items ?? []) {
      for (const member of channel.members) {
        if (member.id !== me.id) byId.set(member.id, member)
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data, me.id])

  return { people, isPending }
}
