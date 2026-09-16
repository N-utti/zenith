import { expect, it } from 'vitest'
import type { AttendanceGrid } from '@/features/attendance/types'
import { attendanceReportCsv } from './attendanceReport'

const day = (work_date: string, status: 'normal' | 'leave') => ({
  work_date,
  day_kind: 'workday' as const,
  status,
  worked_days: status === 'normal' ? 1 : 0,
  overtime_minutes: 0,
  night_minutes: 0,
  note: null,
})

it('집계 뒤에 일자 열이 오고, 쉼표·따옴표가 든 값은 감싼다', () => {
  const grid: AttendanceGrid = {
    month: '2026-09',
    items: [
      {
        user: {
          id: 'u1',
          name: '김"철수", 대리',
          role: 'member',
          team: { id: 't1', name: '개발' },
        },
        days: [day('2026-09-01', 'normal'), day('2026-09-02', 'leave')],
        summary: { worked_days: 1, leave_days: 1, overtime_minutes: 90, night_minutes: 0 },
      },
    ],
  }
  const [header, row] = attendanceReportCsv(grid).split('\r\n')
  expect(header).toBe('이름,팀,근무일,휴가일,"연장근로(분, 승인 신고 기준)",야간(분),09-01,09-02')
  expect(row).toBe('"김""철수"", 대리",개발,1,1,90,0,정상,휴가')
})

it('수식으로 읽힐 셀은 무력화하고, 어떤 사람에게만 없는 날짜는 빈 칸', () => {
  const grid: AttendanceGrid = {
    month: '2026-09',
    items: [
      {
        user: { id: 'u1', name: '=1+1', role: 'member', team: null },
        days: [day('2026-09-01', 'normal'), day('2026-09-02', 'normal')],
        summary: { worked_days: 2, leave_days: 0, overtime_minutes: 0, night_minutes: 0 },
      },
      {
        user: { id: 'u2', name: '신입', role: 'member', team: null },
        days: [day('2026-09-02', 'normal')],
        summary: { worked_days: 1, leave_days: 0, overtime_minutes: 0, night_minutes: 0 },
      },
    ],
  }
  const rows = attendanceReportCsv(grid).split('\r\n')
  expect(rows[1]).toBe("'=1+1,,2,0,0,0,정상,정상")
  expect(rows[2]).toBe('신입,,1,0,0,0,,정상')
})
