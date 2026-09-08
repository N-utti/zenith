import type { AttendanceDay, AttendanceMonth } from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { LEAVE_TYPES, listLeaves } from './leavesDb'

/**
 * 공휴일 시드(10 §6.1 `holidays`). 실제로는 exec 가 연초에 등록한다(SCR-ATT-07).
 * ponytail: 올해 것만 손으로 넣었다. 다른 해를 열면 공휴일 없이 평일만 근무일이 된다.
 */
const HOLIDAYS: Record<string, string> = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-03': '지방선거',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
}

/** 오늘에서 n일 뒤의 평일. `leavesDb.workday` 와 같은 규칙. */
function workday(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  return toISODate(date)
}

/**
 * 승인된 재택·외근·출장 시드(10 §4.1 `work_arrangements`). 누구로 로그인해도 같은 날에 깔린다.
 * 신청·목록은 SCR-ATT-03 에서 붙는다. 그때 이 배열이 사용자별 저장소로 바뀐다.
 */
const ARRANGEMENTS: Array<[kind: 'remote' | 'field' | 'trip', start: string, end: string]> = [
  ['trip', workday(-9), workday(-8)],
  ['field', workday(-3), workday(-3)],
  ['remote', workday(4), workday(4)],
]

/** 승인된 연장근로 시드(10 §4.1 `overtime_requests`). 분·야간분은 서버 산출값(10 §5.3). */
const OVERTIME: Array<[date: string, minutes: number, night: number]> = [
  [workday(-10), 180, 0], // 18:00~21:00
  [workday(-2), 300, 180], // 20:00~익일 01:00
]

/** `2026-09` 의 근무일 행. 주말·공휴일은 행을 만들지 않는다(10 §4.2.2). */
function workdaysOf(month: string): string[] {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year, m, 0).getDate()
  const days: string[] = []
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, m - 1, d)
    const weekday = date.getDay()
    const iso = toISODate(date)
    if (weekday !== 0 && weekday !== 6 && !HOLIDAYS[iso]) days.push(iso)
  }
  return days
}

/** 10 §5.2 상태 판정. 위 규칙이 먼저 이긴다: 휴가 > 반차 > 예외근무 > 정상. */
export function attendanceMonth(user: User, month: string): AttendanceMonth {
  const leaves = listLeaves(user).filter((r) => r.status === 'approved')
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
    const arrangement = ARRANGEMENTS.find(([, start, end]) => start <= iso && end >= iso)
    if (leave && unitOf(leave.type_code) === 'day') {
      day.status = 'leave'
      day.worked_days = 0
    } else if (leave) {
      day.status = 'half_leave'
      day.worked_days = 0.5
    } else if (arrangement) {
      day.status = arrangement[0]
    }
    const overtime = OVERTIME.find(([date]) => date === iso)
    if (overtime) {
      day.overtime_minutes = overtime[1]
      day.night_minutes = overtime[2]
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
      worked_days: days.filter((d) => d.work_date <= today).reduce((sum, d) => sum + d.worked_days, 0),
      leave_days: days.reduce((sum, d) => sum + (d.status === 'leave' ? 1 : 0) + (d.status === 'half_leave' ? 0.5 : 0), 0),
      overtime_minutes: days.reduce((sum, d) => sum + d.overtime_minutes, 0),
      night_minutes: days.reduce((sum, d) => sum + d.night_minutes, 0),
    },
  }
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
