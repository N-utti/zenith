import { Link } from 'react-router'
import { Hash } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { hueOf } from '@/lib/avatar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { HomeSection } from './HomeSection'
import { useUnreadChannels } from './api'

/**
 * 안 읽은 대화. 홈 한 벌의 `unread` 를 쓴다.
 *
 * 서버가 0인 채널을 빼고 주므로 여기서 거르지 않는다. DM 은 상대 이름이 실려 온다.
 */
export function UnreadChatCard() {
  const { data: unread, isPending, isError, refetch } = useUnreadChannels()

  return (
    <HomeSection title="안 읽은 메시지" to="/chat">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && !unread && <CardEmpty onRetry={refetch}>채팅을 불러오지 못했습니다.</CardEmpty>}

        {unread &&
          (unread.length === 0 ? (
            <CardEmpty>모두 읽었습니다.</CardEmpty>
          ) : (
            <ul>
              {unread.map((channel, index) => (
                <li key={channel.channel_id}>
                  <Link
                    to={`/chat/${channel.channel_id}`}
                    className={
                      'hover:bg-surface-hover flex items-center gap-2 px-4 py-3 transition-colors' +
                      (index > 0 ? ' border-line border-t' : '')
                    }
                  >
                    {channel.is_dm ? (
                      /*
                       * 색은 사람으로 정한다. 이름으로 만들면 같은 사람이 대화 안 말풍선
                       * (`MessageList`)·상대 고르기·홈 멘션과 다른 색이 된다. 채널이면
                       * `peer_id` 가 `null` 이라 이름으로 만든다(DM 이 아니니 사람도 없다).
                       */
                      <Avatar
                        name={channel.name}
                        hue={hueOf(channel.peer_id ?? channel.name)}
                        size="sm"
                        className="size-6"
                      />
                    ) : (
                      <Hash className="text-subtle size-4 shrink-0" />
                    )}
                    <span className="text-fg min-w-0 flex-1 truncate text-[13px]">
                      {channel.name}
                      {channel.is_dm && <span className="text-subtle"> (DM)</span>}
                    </span>
                    <span className="bg-accent text-on-accent shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                      {channel.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
