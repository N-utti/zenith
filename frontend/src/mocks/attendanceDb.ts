import type {
  Arrangement,
  AttendanceGrid,
  ArrangementInput,
  ArrangementOnCalendar,
  AttendanceDay,
  AttendanceMonth,
  AttendanceRange,
  Correction,
  CorrectionInput,
  Overtime,
  OvertimeInput,
  RequestStatus,
} from '@/features/attendance/types'
import { overtimeMinutes } from '@/features/attendance/overtimeMinutes'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { DEMO_ACCOUNTS } from './accounts'
import { MOCK_USERS } from './db'
import { ISO_DATE, LEAVE_TYPES, listLeaves } from './leavesDb'
import { isClosedRange, MONTH_CLOSED } from './closingsDb'
import { isHoliday } from './holidaysDb'

/** 오늘에서 n일 뒤의 평일. `leavesDb.workday` 와 같은 규칙. */
function workday(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  while (date.getDay() === 0 || date.getDay() === 6 || isHoliday(toISODate(date)))
    date.setDate(date.getDate() + 1)
  return toISODate(date)
}

let seq = 1
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// ── 재택·외근·출장 ─────────────────────────────────────────────

const arrangements = new Map<string, Arrangement[]>()

/** 홈 캘린더가 비어 보이지 않게 오늘 언저리에 깔아 두는 남의 예외 근무(승인분). */
const EXTRA_ARRANGEMENTS: Array<
  [userId: string, kind: Arrangement['kind'], start: string, end: string]
> = [
  ['u-3', 'trip', workday(3), workday(5)],
  ['u-5', 'remote', workday(0), workday(0)],
  ['u-7', 'field', workday(-2), workday(-2)],
  ['u-8', 'remote', workday(7), workday(7)],
]

function arrangement(
  kind: Arrangement['kind'],
  start: string,
  end: string,
  status: RequestStatus,
  reason = '',
): Arrangement {
  return {
    id: `ar-${seq++}`,
    kind,
    start_date: start,
    end_date: end,
    reason,
    status,
    created_at: daysAgo(12),
    decided_at: status === 'pending' ? null : daysAgo(11),
  }
}

/** 로그인 바로가기 계정. 시연용 기본 시드는 이들에게만 깐다. 전원에게 깔면 홈 캘린더에 13명이 같은 날 출장을 간다. */
const DEMO_IDS = new Set(
  MOCK_USERS.filter((u) => DEMO_ACCOUNTS.some((a) => a.email === u.email)).map((u) => u.id),
)

function arrangementsFor(user: User): Arrangement[] {
  let list = arrangements.get(user.id)
  if (!list) {
    // 시연 계정: 지난 출장·외근 하나씩, 다음 주 재택 하나, 대기 중 하나.
    list = [
      ...(DEMO_IDS.has(user.id)
        ? [
            arrangement('trip', workday(-9), workday(-8), 'approved', '거래처 방문'),
            arrangement('field', workday(-3), workday(-3), 'approved', '현장 점검'),
            arrangement('remote', workday(4), workday(4), 'approved', '집중 작업'),
            arrangement('remote', workday(9), workday(9), 'pending', '이사'),
          ]
        : []),
      ...EXTRA_ARRANGEMENTS.filter(([id]) => id === user.id).map(([, kind, start, end]) =>
        arrangement(kind, start, end, 'approved'),
      ),
    ]
    arrangements.set(user.id, list)
  }
  return list
}

export function listArrangements(user: User): Arrangement[] {
  return [...arrangementsFor(user)].sort((a, b) => b.start_date.localeCompare(a.start_date))
}

/** 기간이 겹치는 전 직원의 승인된 예외 근무. `listLeavesInRange` 와 같은 모양. */
export function listArrangementsInRange(from: string, to: string): ArrangementOnCalendar[] {
  return MOCK_USERS.flatMap((user) =>
    arrangementsFor(user)
      .filter((r) => r.status === 'approved' && r.start_date <= to && r.end_date >= from)
      .map((r) => ({
        id: r.id,
        user: { id: user.id, name: user.name },
        kind: r.kind,
        start_date: r.start_date,
        end_date: r.end_date,
      })),
  )
}

type Failure = { error: string; status: number; code: string }
const invalid = (error: string): Failure => ({
  error,
  status: 422,
  code: 'VALIDATION',
})

export function createArrangement(
  user: User,
  input: ArrangementInput,
): { item: Arrangement } | Failure {
  if (!['remote', 'field', 'trip'].includes(input.kind)) return invalid('없는 종류입니다.')
  if (
    !ISO_DATE.test(input.start_date) ||
    !ISO_DATE.test(input.end_date) ||
    input.end_date < input.start_date
  ) {
    return invalid('기간이 올바르지 않습니다.')
  }
  if (!input.reason?.trim()) return invalid('사유를 입력해 주세요.')
  if (isClosedRange(input.start_date, input.end_date)) return MONTH_CLOSED
  const item = arrangement(
    input.kind,
    input.start_date,
    input.end_date,
    'pending',
    input.reason.trim(),
  )
  item.created_at = new Date().toISOString()
  arrangementsFor(user).push(item)
  return { item }
}

// ── 연장근로 ───────────────────────────────────────────────────

const overtimes = new Map<string, Overtime[]>()

function overtime(
  date: string,
  start: string,
  end: string,
  status: RequestStatus,
  reason: string,
): Overtime {
  return {
    id: `ot-${seq++}`,
    work_date: date,
    start_time: start,
    end_time: end,
    ...overtimeMinutes(start, end),
    reason,
    status,
    created_at: daysAgo(3),
    decided_at: status === 'pending' ? null : daysAgo(2),
  }
}

function overtimesFor(user: User): Overtime[] {
  let list = overtimes.get(user.id)
  if (!list) {
    list = [
      overtime(workday(-10), '18:00', '21:00', 'approved', '배포 대응'),
      overtime(workday(-2), '20:00', '01:00', 'approved', '장애 처리'),
      overtime(workday(-1), '18:00', '19:30', 'pending', '보고서 마감'),
    ]
    overtimes.set(user.id, list)
  }
  return list
}

export function listOvertime(user: User, from: string, to: string) {
  const items = overtimesFor(user)
    .filter((r) => r.work_date >= from && r.work_date <= to)
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
  // 누계는 승인분만(10 §5.3). 대기·반려·취소는 세지 않는다.
  const approved = items.filter((r) => r.status === 'approved')
  return {
    items,
    summary: {
      minutes: approved.reduce((sum, r) => sum + r.minutes, 0),
      night_minutes: approved.reduce((sum, r) => sum + r.night_minutes, 0),
    },
  }
}

const TIME = /^\d{2}:\d{2}$/

export function createOvertime(user: User, input: OvertimeInput): { item: Overtime } | Failure {
  if (!ISO_DATE.test(input.work_date)) return invalid('일자가 올바르지 않습니다.')
  if (!TIME.test(input.start_time) || !TIME.test(input.end_time))
    return invalid('시각이 올바르지 않습니다.')
  if (!input.reason?.trim()) return invalid('사유를 입력해 주세요.')
  if (overtimeMinutes(input.start_time, input.end_time).minutes === 0) {
    return invalid('소정 종업 시각(18:00) 이후 구간이 없습니다.')
  }
  if (isClosedRange(input.work_date)) return MONTH_CLOSED
  const item = overtime(
    input.work_date,
    input.start_time,
    input.end_time,
    'pending',
    input.reason.trim(),
  )
  item.created_at = new Date().toISOString()
  overtimesFor(user).push(item)
  return { item }
}

// ── 정정 신청 ──────────────────────────────────────────────────

const corrections = new Map<string, Correction[]>()

function correctionsFor(user: User): Correction[] {
  let list = corrections.get(user.id)
  if (!list) {
    corrections.set(user.id, (list = []))
  }
  return list
}

export function listCorrections(user: User): Correction[] {
  return [...correctionsFor(user)].sort((a, b) => b.work_date.localeCompare(a.work_date))
}

export function createCorrection(
  user: User,
  input: CorrectionInput,
): { item: Correction } | Failure {
  if (!ISO_DATE.test(input.work_date)) return invalid('일자가 올바르지 않습니다.')
  if (!input.after || (!input.after.status && !input.after.note))
    return invalid('바꿀 내용이 없습니다.')
  if (!input.reason?.trim()) return invalid('사유를 입력해 주세요.')
  if (isClosedRange(input.work_date)) return MONTH_CLOSED
  const item: Correction = {
    id: `cr-${seq++}`,
    work_date: input.work_date,
    after: input.after,
    reason: input.reason.trim(),
    status: 'pending',
    created_at: new Date().toISOString(),
    decided_at: null,
  }
  correctionsFor(user).push(item)
  return { item }
}

// ── 취소 (공통) ────────────────────────────────────────────────

const STORES = {
  arrangements: arrangementsFor,
  overtime: overtimesFor,
  corrections: correctionsFor,
} as const

export type ExceptionStore = keyof typeof STORES

/** 승인 전 취소. 휴가(`cancelLeave`)와 같은 규칙: pending 만, 아니면 409. */
export function cancelException(
  user: User,
  store: ExceptionStore,
  id: string,
): { status: RequestStatus } | 'not_found' | 'conflict' {
  const item = (
    STORES[store](user) as Array<{
      id: string
      status: RequestStatus
      decided_at: string | null
    }>
  ).find((r) => r.id === id)
  if (!item) return 'not_found'
  if (item.status !== 'pending') return 'conflict'
  item.status = 'canceled'
  item.decided_at = new Date().toISOString()
  return item
}

// ── 내 근태 ────────────────────────────────────────────────────

/** `2026-09` 의 근무일 행. 주말·공휴일은 행을 만들지 않는다(10 §4.2.2). */
function workdaysOf(month: string): string[] {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year, m, 0).getDate()
  const days: string[] = []
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, m - 1, d)
    const weekday = date.getDay()
    const iso = toISODate(date)
    if (weekday !== 0 && weekday !== 6 && !isHoliday(iso)) days.push(iso)
  }
  return days
}

/**
 * 10 §5.2 상태 판정. 위 규칙이 먼저 이긴다: 휴가 > 반차 > 예외근무 > 정상.
 * ponytail: 승인된 정정은 반영하지 않는다. 목에서는 아무도 승인하지 않으니 생길 일이 없다.
 */
export function attendanceMonth(user: User, month: string): AttendanceMonth {
  const leaves = listLeaves(user).filter((r) => r.status === 'approved')
  const approvedArrangements = arrangementsFor(user).filter((r) => r.status === 'approved')
  const approvedOvertime = overtimesFor(user).filter((r) => r.status === 'approved')
  const unitOf = (code: string) => LEAVE_TYPES.find((t) => t.code === code)?.unit ?? 'day'

  const days: AttendanceDay[] = workdaysOf(month).map((iso) => {
    const day: AttendanceDay = {
      work_date: iso,
      day_kind: 'workday',
      status: 'normal',
      worked_days: 1,
      overtime_minutes: 0,
      night_minutes: 0,
      note: null,
    }
    const leave = leaves.find((r) => r.start_date <= iso && r.end_date >= iso)
    const arrangement = approvedArrangements.find((r) => r.start_date <= iso && r.end_date >= iso)
    if (leave && unitOf(leave.type_code) === 'day') {
      day.status = 'leave'
      day.worked_days = 0
    } else if (leave) {
      day.status = 'half_leave'
      day.worked_days = 0.5
    } else if (arrangement) {
      day.status = arrangement.kind
    }
    for (const ot of approvedOvertime.filter((r) => r.work_date === iso)) {
      day.overtime_minutes += ot.minutes
      day.night_minutes += ot.night_minutes
    }
    return day
  })

  // 근무일 행은 1년치가 미리 있다(FR-ATT-10·12). 집계에서 "근무"는 지난 날만 센다.
  // 안 그러면 1일에 열어도 "근무 22일"이 뜬다. 휴가·연장은 승인된 계획이라 달 전체를 센다(프론트 가정, PR 본문).
  const today = toISODate(new Date())
  return {
    month,
    days,
    summary: {
      worked_days: days
        .filter((d) => d.work_date <= today)
        .reduce((sum, d) => sum + d.worked_days, 0),
      leave_days: days.reduce(
        (sum, d) => sum + (d.status === 'leave' ? 1 : 0) + (d.status === 'half_leave' ? 0.5 : 0),
        0,
      ),
      overtime_minutes: days.reduce((sum, d) => sum + d.overtime_minutes, 0),
      night_minutes: days.reduce((sum, d) => sum + d.night_minutes, 0),
    },
  }
}

/**
 * 기간 집계(`GET /attendance/me/summary`). 달 조회를 구간만큼 돌려 합친다.
 *
 * "근무" 는 달 집계와 같은 규칙으로 **지난 날만** 센다. 안 그러면 올해 전체를 고른 순간 남은
 * 달의 근무일까지 미리 세어 실제보다 크게 나온다.
 */
export function attendanceRange(user: User, from: string, to: string): AttendanceRange {
  const summary = { worked_days: 0, leave_days: 0, overtime_minutes: 0, night_minutes: 0 }
  const today = toISODate(new Date())
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00`)
  const last = to.slice(0, 7)

  while (toISODate(cursor).slice(0, 7) <= last) {
    const month = toISODate(cursor).slice(0, 7)
    for (const day of attendanceMonth(user, month).days) {
      if (day.work_date < from || day.work_date > to) continue
      if (day.work_date <= today) summary.worked_days += day.worked_days
      if (day.status === 'leave') summary.leave_days += 1
      if (day.status === 'half_leave') summary.leave_days += 0.5
      summary.overtime_minutes += day.overtime_minutes
      summary.night_minutes += day.night_minutes
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return { from, to, summary }
}

/** 전 직원의 한 달(전사 근태 탭). 권한 판정은 핸들러가 한다. */
export function companyAttendance(month: string): AttendanceGrid {
  return {
    month,
    items: MOCK_USERS.map((user) => {
      const { days, summary } = attendanceMonth(user, month)
      return {
        user: { id: user.id, name: user.name, role: user.role, team: user.team },
        days,
        summary,
      }
    }),
  }
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
