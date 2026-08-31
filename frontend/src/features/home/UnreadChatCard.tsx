import { Link } from 'react-router'
import { Hash } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useChannels } from '@/features/chat/api'
import { HomeSection } from './HomeSection'

export function UnreadChatCard() {
  const { data, isPending, isError } = useChannels()
  const unread = data?.items.filter((channel) => channel.unread > 0) ?? []

  return (
    <HomeSection title="안 읽은 메시지" to="/chat">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && <CardEmpty>채팅을 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (unread.length === 0 ? (
            <CardEmpty>모두 읽었습니다.</CardEmpty>
          ) : (
            <ul>
              {unread.map((channel, index) => (
                <li key={channel.id}>
                  <Link
                    to={`/chat/${channel.id}`}
                    className={
                      'hover:bg-surface-hover flex items-center gap-2 px-4 py-3 transition-colors' +
                      (index > 0 ? ' border-line border-t' : '')
                    }
                  >
                    {channel.kind === 'channel' ? (
                      <Hash className="text-subtle size-4 shrink-0" />
                    ) : (
                      <Avatar name={channel.name} hue={200} size="sm" className="size-6" />
                    )}
                    <span className="text-fg min-w-0 flex-1 truncate text-[13px]">
                      {channel.name}
                      {channel.kind === 'dm' && <span className="text-subtle"> (DM)</span>}
                    </span>
                    <span className="bg-accent text-on-accent shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                      {channel.unread}
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
