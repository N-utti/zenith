import { ATTENDANCE_STATUS_LABEL, type AttendanceGrid } from '@/features/attendance/types'

/**
 * 쉼표·따옴표·줄바꿈이 든 값만 따옴표로 감싼다(RFC 4180).
 * `=`·`+`·`-`·`@` 로 시작하는 셀은 엑셀이 수식으로 실행한다. 이름·팀명이 그렇게 오면 작은따옴표로 무력화한다.
 * 실제 서버도 같은 방어를 해야 한다(PR 본문).
 */
function cell(value: string | number): string {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * 월 근태 리포트 CSV(10 §9.5 `GET /attendance/report?month=&format=csv`, exec).
 * 앞은 사람별 집계, 뒤는 일자별 상태. 연장·야간은 승인 신고분(분)이라 열 이름에 그렇게 적는다.
 * 사유는 싣지 않는다(10 §8: 리포트에는 종류만).
 * 실제 서버도 같은 열 순서로 내면 프론트는 손댈 게 없다.
 */
export function attendanceReportCsv(grid: AttendanceGrid): string {
  const dates = [...new Set(grid.items.flatMap((r) => r.days.map((d) => d.work_date)))].sort()
  const header = [
    '이름',
    '팀',
    '근무일',
    '휴가일',
    '연장근로(분, 승인 신고 기준)',
    '야간(분)',
    ...dates.map((d) => d.slice(5)),
  ]
  const rows = grid.items.map((r) => {
    const byDate = new Map(r.days.map((d) => [d.work_date, d]))
    return [
      r.user.name,
      r.user.team?.name ?? '',
      r.summary.worked_days,
      r.summary.leave_days,
      r.summary.overtime_minutes,
      r.summary.night_minutes,
      ...dates.map((d) => {
        const day = byDate.get(d)
        return day ? ATTENDANCE_STATUS_LABEL[day.status] : ''
      }),
    ]
  })
  return [header, ...rows].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
