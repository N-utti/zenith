import type { LeaveOnCalendar } from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import type { CalendarEvent } from './types'

/** 캘린더 칸 하나에 그리는 항목. 내 일정이 앞, 남의 휴가가 뒤. */
export type CalendarItem =
  | { kind: 'event'; id: string; label: string; event: CalendarEvent }
  | { kind: 'leave'; id: string; label: string; leave: LeaveOnCalendar }

/** `2026-09-08` 의 다음 날. 문자열끼리 비교하려고 ISO 로 되돌린다. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + 1))
}

/**
 * 날짜별 항목. 휴가는 기간을 하루씩 펼치되 `range` 밖은 걷는다(연말 장기 휴가가 화면 밖까지 돌지 않게).
 * 어떤 휴가를 보여 줄지(승인분만)는 서버가 정한다. 여기서 거르지 않는다.
 */
export function itemsByDay(
  leaves: LeaveOnCalendar[],
  events: CalendarEvent[],
  typeName: (code: string) => string,
  range: { from: string; to: string },
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

  const byName = [...leaves].sort((a, b) => a.user.name.localeCompare(b.user.name, 'ko'))
  for (const leave of byName) {
    const label = `${leave.user.name} ${typeName(leave.type_code)}`
    const start = leave.start_date < range.from ? range.from : leave.start_date
    const end = leave.end_date > range.to ? range.to : leave.end_date
    for (let iso = start; iso <= end; iso = nextDay(iso)) {
      push(iso, { kind: 'leave', id: `${leave.id}:${iso}`, label, leave })
    }
  }
  return days
}
