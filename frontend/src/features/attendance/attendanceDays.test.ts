import { describe, expect, it } from 'vitest'
import { cellStatus, formatMinutes, indexByDate } from './attendanceDays'
import type { AttendanceDay } from './types'

const row = (work_date: string, status: AttendanceDay['status']): AttendanceDay => ({
  work_date,
  day_kind: 'workday',
  status,
  worked_days: status === 'normal' ? 1 : 0,
  overtime_minutes: 0,
  night_minutes: 0,
  note: null,
})

describe('캘린더 칸 상태', () => {
  const days = indexByDate([row('2026-08-14', 'normal'), row('2026-08-18', 'leave')])

  const at = (iso: string, isWeekend = false, inMonth = true) => ({ iso, isWeekend, inMonth })

  it('행이 있으면 그 상태', () => {
    expect(cellStatus(days, at('2026-08-18'))).toBe('leave')
  })

  it('행 없는 평일은 휴일, 주말은 비움', () => {
    // 2026-08-17(월)은 광복절 대체공휴일이라 행이 없다.
    expect(cellStatus(days, at('2026-08-17'))).toBe('holiday')
    expect(cellStatus(days, at('2026-08-15', true))).toBe('none')
  })

  it('이웃 달 평일과 달력이 아직 없는 달은 휴일로 칠하지 않는다', () => {
    expect(cellStatus(days, at('2026-08-31', false, false))).toBe('none')
    expect(cellStatus(new Map(), at('2027-01-04'))).toBe('none')
  })
})

describe('연장 시간 표기', () => {
  it('시간·분으로 접는다', () => {
    expect(formatMinutes(0)).toBe('0시간')
    expect(formatMinutes(180)).toBe('3시간')
    expect(formatMinutes(90)).toBe('1시간 30분')
  })
})
