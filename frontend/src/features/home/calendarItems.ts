import {
  ATTENDANCE_STATUS_LABEL,
  type ArrangementOnCalendar,
  type LeaveOnCalendar,
} from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import type { CalendarEvent } from './types'

/**
 * 캘린더 칸 하나에 그리는 항목. 내 일정이 앞, 남의 부재가 뒤.
 * 휴가와 재택·외근·출장은 홈에서 한 범주(`absence`)다. 홈 캘린더는 "누가 왜 자리에 없나"를 보는
 * 곳이라 둘을 가를 이유가 없고, 무엇 때문인지는 라벨("김다인 연차"·"홍성완 출장")이 말한다(2026-09-08 결정).
 */
export type CalendarItem =
  | { kind: 'event'; id: string; label: string; event: CalendarEvent }
  | { kind: 'absence'; id: string; label: string }

/** `2026-09-08` 의 다음 날. 문자열끼리 비교하려고 ISO 로 되돌린다. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + 1))
}

/**
 * 날짜별 항목. 부재는 기간을 하루씩 펼치되 `range` 밖은 걷는다(연말 장기 휴가가 화면 밖까지 돌지 않게).
 * 어떤 것을 보여 줄지(승인분만)는 서버가 정한다. 여기서 거르지 않는다.
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

  // 휴가와 예외 근무를 한 목록으로 합쳐 이름순. 같은 사람의 연차와 출장이 나란히 온다.
  const absences = [
    ...leaves.map((r) => ({ ...r, id: `lv:${r.id}`, what: typeName(r.type_code) })),
    ...arrangements.map((r) => ({ ...r, id: `ar:${r.id}`, what: ATTENDANCE_STATUS_LABEL[r.kind] })),
  ].sort((a, b) => a.user.name.localeCompare(b.user.name, 'ko'))

  for (const absence of absences) {
    const label = `${absence.user.name} ${absence.what}`
    const start = absence.start_date < range.from ? range.from : absence.start_date
    const end = absence.end_date > range.to ? range.to : absence.end_date
    for (let iso = start; iso <= end; iso = nextDay(iso)) {
      push(iso, { kind: 'absence', id: `${absence.id}:${iso}`, label })
    }
  }
  return days
}
