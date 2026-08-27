import { NavLink } from 'react-router'
import { AtSign, Hash } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useChannels } from './api'
import type { ChatChannel } from './types'

function Row({ channel }: { channel: ChatChannel }) {
  const Icon = channel.kind === 'channel' ? Hash : AtSign

  return (
    <NavLink
      to={`/chat/${channel.id}`}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
          isActive ? 'bg-accent-soft' : 'hover:bg-surface-hover',
        )
      }
    >
      <Icon className="text-subtle size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm',
            channel.unread > 0 ? 'text-fg font-semibold' : 'text-muted',
          )}
        >
          {channel.name}
        </p>
        {channel.lastMessage && (
          <p className="text-subtle truncate text-xs">{channel.lastMessage}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {channel.unread > 0 && (
          <span className="bg-accent text-on-accent rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
            {channel.unread}
          </span>
        )}
        {channel.lastAt && (
          <span className="text-subtle text-[11px]">{formatRelative(channel.lastAt)}</span>
        )}
      </div>
    </NavLink>
  )
}

export function ChannelList() {
  const { data, isPending, isError } = useChannels()

  const channels = data?.items.filter((c) => c.kind === 'channel') ?? []
  const dms = data?.items.filter((c) => c.kind === 'dm') ?? []

  return (
    <nav className="border-line bg-surface flex w-full shrink-0 flex-col overflow-y-auto border-b md:w-64 md:border-r md:border-b-0">
      {isPending && (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      )}
      {isError && (
        <p className="text-subtle px-4 py-8 text-center text-sm">채널을 불러오지 못했습니다.</p>
      )}

      {data && (
        <div className="space-y-4 p-2">
          <section>
            <h2 className="text-subtle px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase">
              채널
            </h2>
            <div className="space-y-0.5">
              {channels.map((channel) => (
                <Row key={channel.id} channel={channel} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-subtle px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase">
              다이렉트 메시지
            </h2>
            <div className="space-y-0.5">
              {dms.length === 0 ? (
                <p className="text-subtle px-2.5 py-2 text-xs">아직 대화가 없습니다.</p>
              ) : (
                dms.map((channel) => <Row key={channel.id} channel={channel} />)
              )}
            </div>
          </section>
        </div>
      )}
    </nav>
  )
}
