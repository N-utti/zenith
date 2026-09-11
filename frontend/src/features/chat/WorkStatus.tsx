import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTodayArrangementKinds } from '@/features/attendance/api'
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/types'
import type { ChatChannel } from './types'

/**
 * DM 상대가 오늘 재택·외근·출장이면 이름 옆에 "재택"처럼 붙는 근무 상태. 근태 모듈이 이미 아는
 * 사실이라 채팅이 따로 presence 를 두지 않는다. 채널이거나 오늘 예외 근무가 없으면 아무것도 안 그린다.
 */
export function WorkStatus({ channel }: { channel: ChatChannel }) {
  const me = useCurrentUser()
  const kinds = useTodayArrangementKinds()
  if (channel.kind !== 'dm') return null
  const other = channel.memberIds.find((id) => id !== me.id)
  const kind = other ? kinds.get(other) : undefined
  if (!kind) return null
  return (
    <span className="text-info shrink-0 text-[11px] font-medium">
      {ATTENDANCE_STATUS_LABEL[kind]}
    </span>
  )
}
