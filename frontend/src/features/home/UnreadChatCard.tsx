import { Link } from 'react-router'
import { AtSign, Hash } from 'lucide-react'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatRelative } from '@/lib/datetime'
import { useUnreadChat } from './api'

export function UnreadChatCard() {
  const { data, isPending, isError } = useUnreadChat()

  return (
    <Card>
      <CardHeader title="안 읽은 채팅" count={data?.total} to="/chat" />

      {isPending && <SkeletonRows />}
      {isError && <CardEmpty>채팅을 불러오지 못했습니다.</CardEmpty>}

      {data &&
        (data.channels.length === 0 ? (
          <CardEmpty>모두 읽었습니다.</CardEmpty>
        ) : (
          <ul className="px-2 pb-2">
            {data.channels.map((channel) => (
              <li key={channel.id}>
                <Link
                  to={`/chat/${channel.id}`}
                  className="hover:bg-surface-hover flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                >
                  {channel.kind === 'channel' ? (
                    <Hash className="text-subtle size-4 shrink-0" />
                  ) : (
                    <AtSign className="text-subtle size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-fg truncate text-sm font-medium">{channel.name}</p>
                    <p className="text-subtle truncate text-xs">{channel.lastMessage}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="bg-accent text-on-accent rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
                      {channel.unread}
                    </span>
                    <span className="text-subtle text-[11px]">{formatRelative(channel.lastAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  )
}
