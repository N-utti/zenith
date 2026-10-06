import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTodayArrangementKinds } from '@/features/attendance/api'
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/types'
import type { ChatChannel } from './types'

/**
 * DM 상대가 오늘 재택·외근·출장이면 이름 옆에 "재택"처럼 붙는 근무 상태 칩. 색은 근태 화면의 재택·외근·출장 칩과 같다. 근태 모듈이 이미 아는
 * 사실이라 채팅이 따로 presence 를 두지 않는다. 채널이거나 오늘 예외 근무가 없으면 아무것도 안 그린다.
 */
export function WorkStatus({ channel }: { channel: ChatChannel }) {
  const me = useCurrentUser()
  const kinds = useTodayArrangementKinds()
  if (!channel.is_dm) return null
  const other = channel.members.find((m) => m.id !== me.id)?.id
  const kind = other ? kinds.get(other) : undefined
  if (!kind) return null
  return (
    <span className="text-info bg-info/12 shrink-0 rounded-full px-2 py-px text-xs leading-4 font-medium">
      {ATTENDANCE_STATUS_LABEL[kind]}
    </span>
  )
}
