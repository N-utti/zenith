import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTodayArrangementKinds } from '@/features/attendance/api'
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/types'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatChannel } from './types'

function dmPartner(channel: ChatChannel, meId: string): string | undefined {
  return channel.is_dm ? channel.members.find((m) => m.id !== meId)?.id : undefined
}

/** DM 상대가 지금 제니스에 접속해 있으면 이름 옆에 붙는 초록 점. 접속 여부는 채팅 소켓의 `presence` 가 알려 준다. */
export function OnlineDot({ channel }: { channel: ChatChannel }) {
  const me = useCurrentUser()
  const { online } = useChatSocketContext()
  const other = dmPartner(channel, me.id)
  if (!other || !online.has(other)) return null
  return (
    <span role="img" aria-label="접속 중" className="bg-success size-2 shrink-0 rounded-full" />
  )
}

/**
 * DM 상대가 오늘 재택·외근·출장이면 이름 옆에 "재택"처럼 붙는 근무 상태 칩. 색은 근태 화면의 재택·외근·출장 칩과 같다.
 * 채널이거나 오늘 예외 근무가 없으면 아무것도 안 그린다.
 */
export function WorkStatus({ channel }: { channel: ChatChannel }) {
  const me = useCurrentUser()
  const kinds = useTodayArrangementKinds()
  const other = dmPartner(channel, me.id)
  const kind = other ? kinds.get(other) : undefined
  if (!kind) return null
  return (
    <span className="text-info bg-info/12 shrink-0 rounded-full px-2 py-px text-xs leading-4 font-medium">
      {ATTENDANCE_STATUS_LABEL[kind]}
    </span>
  )
}
