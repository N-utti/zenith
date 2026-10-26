import { Avatar } from '@/components/ui/Avatar'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTodayArrangementKinds } from '@/features/attendance/api'
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/types'
import { hueOf } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatChannel } from './types'

function dmPartner(channel: ChatChannel, meId: string) {
  return channel.is_dm ? channel.members.find((m) => m.id !== meId) : undefined
}

/**
 * DM 줄 맨 앞의 상대 아바타. 상대가 지금 제니스에 접속해 있으면 오른쪽 아래에 초록 점이 붙는다.
 * 접속 여부는 채팅 소켓의 `presence` 가 알려 준다.
 *
 * 점 둘레는 줄 바탕색으로 둘러 아바타에서 떼어 낸다. 줄 바탕은 상태(평소·올림·선택)마다 달라서
 * 그 색은 줄을 그리는 쪽이 `dotRing` 으로 준다. 상대를 못 찾으면(혼자 남은 DM) 자리만 비워 둔다.
 */
export function DmAvatar({ channel, dotRing }: { channel: ChatChannel; dotRing: string }) {
  const me = useCurrentUser()
  const { online } = useChatSocketContext()
  const other = dmPartner(channel, me.id)
  if (!other) return <span className="w-5 shrink-0" />
  return (
    <span className="relative shrink-0">
      <Avatar name={other.name} hue={hueOf(other.id)} size="xs" />
      {online.has(other.id) && (
        <span
          role="img"
          aria-label="접속 중"
          className={cn(
            'bg-success absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2',
            dotRing,
          )}
        />
      )}
    </span>
  )
}

/**
 * DM 상대가 오늘 재택·외근·출장이면 이름 옆에 "재택"처럼 붙는 근무 상태 칩. 색은 근태 화면의 재택·외근·출장 칩과 같다.
 * 채널이거나 오늘 예외 근무가 없으면 아무것도 안 그린다.
 */
export function WorkStatus({ channel }: { channel: ChatChannel }) {
  const me = useCurrentUser()
  const kinds = useTodayArrangementKinds()
  const other = dmPartner(channel, me.id)?.id
  const kind = other ? kinds.get(other) : undefined
  if (!kind) return null
  return (
    <span className="text-info bg-info/12 shrink-0 rounded-full px-2 py-px text-xs leading-4 font-medium">
      {ATTENDANCE_STATUS_LABEL[kind]}
    </span>
  )
}
