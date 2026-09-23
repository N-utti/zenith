import { Badge } from '@/components/ui/Badge'
import { splitMentions } from './mentions'

/**
 * 본문의 `@이름` 을 배지로(05 SCR-02·SCR-04 멘션 파란 배지). 문서 댓글과 채팅 메시지가 같이 쓴다.
 * `names` 에 있는 이름만 칠한다. 서버가 알림을 만드는 사람과 맞춰, 목록에서 한 번 만들어 넘긴다
 * (댓글은 `useMentionNames`, 채팅은 채널 멤버).
 */
export function MentionText({ body, names }: { body: string; names: ReadonlySet<string> }) {
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
