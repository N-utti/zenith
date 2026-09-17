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
  const { data: unread, isPending, isError } = useUnreadChannels()

  return (
    <HomeSection title="안 읽은 메시지" to="/chat">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && <CardEmpty>채팅을 불러오지 못했습니다.</CardEmpty>}

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
                       * 홈 한 벌의 `UnreadChannel` 에는 상대 id 가 없어 이름으로 색을 만든다.
                       * 그래서 같은 사람이 채팅 사이드바(`hueOf(id)`)와 여기서 색이 다르다.
                       * 백엔드에 `peer_id` 를 요청해 뒀다(PR 본문·README).
                       */
                      <Avatar
                        name={channel.name}
                        hue={hueOf(channel.name)}
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
