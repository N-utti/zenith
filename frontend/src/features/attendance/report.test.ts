import { expect, it } from 'vitest'
import { reportRows } from './report'
import type { AttendanceGrid } from './types'

const day = (work_date: string, status: 'normal' | 'leave') => ({
  work_date,
  day_kind: 'workday' as const,
  status,
  worked_days: status === 'normal' ? 1 : 0,
  overtime_minutes: 0,
  night_minutes: 0,
  note: null,
})

it('집계 뒤에 그달 모든 날이 요일과 함께 오고, 행이 없는 날은 빈 칸', () => {
  const grid: AttendanceGrid = {
    month: '2026-09',
    items: [
      {
        user: { id: 'u1', name: '김철수', role: 'member', team: { id: 't1', name: '개발' } },
        days: [day('2026-09-01', 'normal'), day('2026-09-02', 'leave')],
        summary: { worked_days: 1, leave_days: 1, overtime_minutes: 90, night_minutes: 0 },
      },
      {
        user: { id: 'u2', name: '신입', role: 'member', team: null },
        days: [day('2026-09-02', 'normal')],
        summary: { worked_days: 1, leave_days: 0, overtime_minutes: 0, night_minutes: 0 },
      },
    ],
  }
  const [header, a, b] = reportRows(grid)
  expect(header).toHaveLength(6 + 30)
  expect(header.slice(0, 8)).toEqual([
    '이름',
    '팀',
    '근무일',
    '휴가일',
    '연장근로(분, 승인 신고 기준)',
    '야간(분)',
    '1(화)',
    '2(수)',
  ])
  expect(a.slice(0, 8)).toEqual(['김철수', '개발', 1, 1, 90, 0, '정상', '휴가'])
  expect(b.slice(0, 8)).toEqual(['신입', '', 1, 0, 0, 0, '', '정상'])
  // 9/5 토요일: 행이 없는 날은 빈 칸.
  expect(a[6 + 4]).toBe('')
})
