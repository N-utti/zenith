import { NavLink } from 'react-router'
import { Hash, Lock, Pencil } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useChannels } from './api'
import { useHasDraft } from './drafts'
import type { ChatChannel } from './types'
import { DmAvatar, WorkStatus } from './WorkStatus'

function Row({ channel }: { channel: ChatChannel }) {
  const isPrivate = !channel.is_dm && channel.is_private === true
  const Icon = isPrivate ? Lock : Hash
  const last = channel.last_message
  const hasDraft = useHasDraft(channel.id)

  return (
    <NavLink
      to={`/chat/${channel.id}`}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
          isActive ? 'bg-accent-soft' : 'hover:bg-surface-hover',
        )
      }
    >
      {channel.is_dm ? (
        <DmAvatar
          channel={channel}
          dotRing="ring-surface group-hover:ring-surface-hover group-aria-[current=page]:ring-accent-soft"
        />
      ) : (
        <Icon
          role={isPrivate ? 'img' : undefined}
          aria-label={isPrivate ? '비공개' : undefined}
          className="text-subtle h-4 w-5 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              channel.unread > 0 ? 'text-fg font-semibold' : 'text-muted',
            )}
          >
            {channel.name}
          </span>
          <WorkStatus channel={channel} />
          {hasDraft && (
            <Pencil role="img" aria-label="작성 중" className="text-subtle size-3.5 shrink-0" />
          )}
        </p>
        {last && <p className="text-subtle truncate text-xs">{last.body}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {channel.unread > 0 && (
          // 높이와 최소 너비를 같게 둬야 한 자리 숫자가 원이 된다. 숫자는 Avatar 처럼 숫자 높이로 잘라 가운데에 둔다.
          <span className="bg-accent text-on-accent inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
            <span className="[text-box:trim-both_cap_alphabetic]">{channel.unread}</span>
          </span>
        )}
        {last && <span className="text-subtle text-[11px]">{formatRelative(last.created_at)}</span>}
      </div>
    </NavLink>
  )
}

/**
 * 모바일 전용 방 목록. 데스크톱은 전역 사이드바(`layout/Sidebar`)의 채널·DM 섹션이 방 목록이라
 * 같은 목록을 두 번 그리지 않는다. 모바일은 사이드바가 서랍이라 방을 고르기 전 화면에 이게 필요하다.
 */
export function ChannelList() {
  const { data, isPending, isError } = useChannels()

  const channels = data?.items.filter((c) => !c.is_dm) ?? []
  const dms = data?.items.filter((c) => c.is_dm) ?? []

  return (
    <nav className="bg-surface flex min-h-0 w-full flex-1 flex-col overflow-y-auto md:hidden">
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
