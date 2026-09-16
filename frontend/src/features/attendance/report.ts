import type { XlsxCell } from '@/lib/xlsx'
import { daysOf, WEEKDAY } from './attendanceDays'
import { ATTENDANCE_STATUS_LABEL, type AttendanceGrid } from './types'

/** 이름부터 야간까지. 표에서 가로로 굴러도 이 열들은 고정된다. */
export const REPORT_FIXED_COLS = 6

/**
 * 월 근태 리포트 표(FR-ATT-15). 앞은 사람별 집계, 뒤는 그달 모든 날의 상태(전사 근태 그리드와 같은 열).
 * 근무일이 아닌 날은 빈 칸이다. 행이 없는 사람도 빈 칸.
 * 연장·야간은 승인 신고분(분)이라 열 이름에 그렇게 적는다(10 §5.3). 사유는 싣지 않는다(10 §8: 리포트에는 종류만).
 * 10 §9.5 의 `GET /attendance/report?format=csv` 대신 전사 그리드로 브라우저가 만든다. 열 고정·너비 같은
 * 서식이 필요해 CSV 로는 안 되고, 서버가 xlsx 를 만들 이유도 없다(PR 본문).
 */
export function reportRows(grid: AttendanceGrid): XlsxCell[][] {
  const dates = daysOf(grid.month)
  const header: XlsxCell[] = [
    '이름',
    '팀',
    '근무일',
    '휴가일',
    '연장근로(분, 승인 신고 기준)',
    '야간(분)',
    ...dates.map((d) => `${d.day}(${WEEKDAY[d.weekday]})`),
  ]
  const rows = grid.items.map((r): XlsxCell[] => {
    const byDate = new Map(r.days.map((d) => [d.work_date, d]))
    return [
      r.user.name,
      r.user.team?.name ?? '',
      r.summary.worked_days,
      r.summary.leave_days,
      r.summary.overtime_minutes,
      r.summary.night_minutes,
      ...dates.map((d) => {
        const day = byDate.get(d.iso)
        return day ? ATTENDANCE_STATUS_LABEL[day.status] : ''
      }),
    ]
  })
  return [header, ...rows]
}
