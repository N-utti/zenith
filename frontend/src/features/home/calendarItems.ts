import {
  ATTENDANCE_STATUS_LABEL,
  type ArrangementOnCalendar,
  type LeaveOnCalendar,
} from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import type { CalendarEvent } from './types'

/** 캘린더 칸 하나에 그리는 항목. 내 일정이 앞, 남의 휴가·예외 근무가 뒤. */
export type CalendarItem =
  | { kind: 'event'; id: string; label: string; event: CalendarEvent }
  | { kind: 'leave'; id: string; label: string; leave: LeaveOnCalendar }
  | {
      kind: 'arrangement'
      id: string
      label: string
      arrangement: ArrangementOnCalendar
    }

/** `2026-09-08` 의 다음 날. 문자열끼리 비교하려고 ISO 로 되돌린다. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + 1))
}

/**
 * 날짜별 항목. 휴가·예외 근무는 기간을 하루씩 펼치되 `range` 밖은 걷는다(연말 장기 휴가가 화면 밖까지 돌지 않게).
 * 어떤 것을 보여 줄지(승인분만)는 서버가 정한다. 여기서 거르지 않는다.
 * 홈 캘린더는 "누가 왜 자리에 없나"를 보는 곳이라 재택·외근·출장도 휴가와 나란히 올린다.
 */
export function itemsByDay(
  leaves: LeaveOnCalendar[],
  events: CalendarEvent[],
  typeName: (code: string) => string,
  range: { from: string; to: string },
  arrangements: ArrangementOnCalendar[] = [],
): Map<string, CalendarItem[]> {
  const days = new Map<string, CalendarItem[]>()
  const push = (iso: string, item: CalendarItem) => {
    const list = days.get(iso)
    if (list) list.push(item)
    else days.set(iso, [item])
  }

  // 시각순. 종일 일정(time 없음)은 빈 문자열이라 맨 앞에 온다. 의도한 순서다.
  const sortedEvents = [...events].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  for (const event of sortedEvents) {
    const label = event.time ? `${event.time} ${event.title}` : event.title
    push(event.date, { kind: 'event', id: event.id, label, event })
  }

  const spread = (start_date: string, end_date: string, item: (iso: string) => CalendarItem) => {
    const start = start_date < range.from ? range.from : start_date
    const end = end_date > range.to ? range.to : end_date
    for (let iso = start; iso <= end; iso = nextDay(iso)) push(iso, item(iso))
  }
  const byName = <T extends { user: { name: string } }>(list: T[]) =>
    [...list].sort((a, b) => a.user.name.localeCompare(b.user.name, 'ko'))

  for (const leave of byName(leaves)) {
    const label = `${leave.user.name} ${typeName(leave.type_code)}`
    spread(leave.start_date, leave.end_date, (iso) => ({
      kind: 'leave',
      id: `${leave.id}:${iso}`,
      label,
      leave,
    }))
  }
  for (const arrangement of byName(arrangements)) {
    const label = `${arrangement.user.name} ${ATTENDANCE_STATUS_LABEL[arrangement.kind]}`
    spread(arrangement.start_date, arrangement.end_date, (iso) => ({
      kind: 'arrangement',
      id: `${arrangement.id}:${iso}`,
      label,
      arrangement,
    }))
  }
  return days
}
