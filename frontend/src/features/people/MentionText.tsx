import { useMemo } from 'react'
import { Badge } from '@/components/ui/Badge'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useColleagues } from './colleagues'
import { splitMentions } from './mentions'

/**
 * 본문의 `@이름` 을 배지로(05 SCR-02·SCR-04 멘션 파란 배지). 문서 댓글과 채팅 메시지가 같이 쓴다.
 * 실제 사람 이름만 칠한다(서버도 그 이름에만 알림을 만든다). 명단은 나를 빼고 주므로 내 이름을
 * 더한다(남이 나를 부른 글).
 */
export function MentionText({ body }: { body: string }) {
  const user = useCurrentUser()
  const { people } = useColleagues()
  const names = useMemo(
    () => new Set([...people.map((person) => person.name), user.name]),
    [people, user.name],
  )

  return splitMentions(body, names).map((part, i) =>
    part.mention ? (
      <Badge key={i} tone="accent" className="px-1 py-0 text-[length:inherit]">
        {part.text}
      </Badge>
    ) : (
      part.text
    ),
  )
}
