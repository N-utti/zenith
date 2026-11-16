import {
  ATTENDANCE_STATUS_LABEL,
  type ArrangementOnCalendar,
  type LeaveOnCalendar,
} from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import type { CalendarEvent } from './types'

/**
 * 색·범례 토글의 묶음. 개인은 내가 적은 일정과 내 휴가·예외 근무, 동료는 남의 일정과 휴가·예외 근무
 * (2026-10-16 사용자 결정. 그 전에는 「내 일정 / 휴가·예외 근무」로 종류를 갈랐다.
 * 동료 일정은 2026-11-16 결정 「모든 일정을 전 직원에게 공개」로 들어왔다).
 */
export type CalendarGroup = 'personal' | 'colleague'

/**
 * 캘린더 칸 하나에 그리는 항목. 개인 묶음이 먼저, 그다음 동료 묶음. 묶음 안에서는 종일(종일 일정 → 부재)
 * → 시각 있는 일정 시각순. 칩이 세 개까지만 보여서, 동료 일정이 많은 날에도 내 연차가 접히지 않게 한다
 * (2026-11-16 사용자 결정).
 * 휴가와 재택·외근·출장은 홈에서 한 범주(`absence`)다. 홈 캘린더는 "누가 왜 자리에 없나"를 보는
 * 곳이라 둘을 가를 이유가 없고, 무엇 때문인지는 라벨("김다인 연차"·"홍성완 출장")이 말한다(2026-09-08 결정).
 */
export type CalendarItem = (
  | { kind: 'event'; group: CalendarGroup; id: string; label: string; event: CalendarEvent }
  | { kind: 'absence'; group: CalendarGroup; id: string; label: string }
) & {
  /**
   * 폰 칸처럼 좁은 자리의 짧은 이름. 내 일정은 시각 뺀 제목, 동료 일정은 이름과 제목, 내 부재는 종류(「출장」, 내 이름은 군더더기),
   * 동료 부재는 이름과 종류(「김다인 연차」, 누가 왜 없는지가 요점이라 사용자 요청으로 종류까지).
   * 시각과 긴 종류(「오전 반차」)가 잘린 나머지는 날짜 창의 `label` 이 말한다.
   */
  short: string
}

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
  meId?: string,
): Map<string, CalendarItem[]> {
  const days = new Map<string, CalendarItem[]>()
  const push = (iso: string, item: CalendarItem) => {
    const list = days.get(iso)
    if (list) list.push(item)
    else days.set(iso, [item])
  }

  // 시각순. 종일 일정(time 없음)은 빈 문자열이라 맨 앞에 온다. 묶음 순서는 맨 끝에서 다시 맞춘다.
  const sortedEvents = [...events].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  for (const event of sortedEvents) {
    // 남의 일정은 누구 것인지가 먼저다. 부재 라벨(「김다인 연차」)과 같은 모양으로 이름을 앞에 둔다.
    const mine = event.user.id === meId
    const title = mine ? event.title : `${event.user.name} ${event.title}`
    push(event.date, {
      kind: 'event',
      group: mine ? 'personal' : 'colleague',
      id: event.id,
      label: event.time ? `${event.time} ${title}` : title,
      short: title,
      event,
    })
  }

  // 휴가와 예외 근무를 한 목록으로 합쳐 내 것이 먼저, 그다음 이름순. 같은 사람의 연차와 출장이
  // 나란히 온다.
  const absences = [
    ...leaves.map((r) => ({ ...r, id: `lv:${r.id}`, what: typeName(r.type_code) })),
    ...arrangements.map((r) => ({ ...r, id: `ar:${r.id}`, what: ATTENDANCE_STATUS_LABEL[r.kind] })),
  ].sort(
    (a, b) =>
      Number(b.user.id === meId) - Number(a.user.id === meId) ||
      a.user.name.localeCompare(b.user.name, 'ko'),
  )

  for (const absence of absences) {
    const label = `${absence.user.name} ${absence.what}`
    const group = absence.user.id === meId ? 'personal' : 'colleague'
    const short = group === 'personal' ? absence.what : label
    const start = absence.start_date < range.from ? range.from : absence.start_date
    const end = absence.end_date > range.to ? range.to : absence.end_date
    for (let iso = start; iso <= end; iso = nextDay(iso)) {
      push(iso, { kind: 'absence', group, id: `${absence.id}:${iso}`, label, short })
    }
  }

  // 개인 먼저, 묶음 안에서는 시각 있는 일정이 뒤로. 정렬이 안정적이라 위에서 넣은 순서(일정 시각순,
  // 부재 이름순)가 그 안에서 남는다.
  const rank = (i: CalendarItem) =>
    (i.group === 'personal' ? 0 : 2) + (i.kind === 'event' && i.event.time ? 1 : 0)
  for (const list of days.values()) list.sort((a, b) => rank(a) - rank(b))
  return days
}

/** 범례에서 켠 묶음만 남긴다. 내 휴가가 개인 쪽이라 목록 단위로는 못 거르고 항목마다 본다. */
export function onlyShown(
  days: Map<string, CalendarItem[]>,
  show: Record<CalendarGroup, boolean>,
): Map<string, CalendarItem[]> {
  return new Map([...days].map(([iso, items]) => [iso, items.filter((i) => show[i.group])]))
}
