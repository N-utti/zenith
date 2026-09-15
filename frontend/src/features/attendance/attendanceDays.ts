import type { AttendanceDay, AttendanceStatus } from './types'

/** 캘린더 칸 하나의 상태. `none` 은 "행이 없고 휴일도 아닌 날"(주말, 달력 미생성). */
export type CellStatus = AttendanceStatus | 'none'

/**
 * 날짜 → 칸 상태. 근무일에만 행이 있으므로(10 §4.2.2) 행이 없는 평일은 공휴일로 읽는다.
 * 예외 둘. 이웃 달 날짜는 조회 범위 밖이라 행이 없는 게 당연하고, 그 달에 행이 하나도
 * 없으면 달력 자체가 아직 없는 것이다. 둘 다 `none`. 그러지 않으면 앞뒤 주와 내년 달력의
 * 평일이 전부 휴일로 칠해진다.
 */
export function cellStatus(
  byDate: Map<string, AttendanceDay>,
  day: { iso: string; isWeekend: boolean; inMonth: boolean },
): CellStatus {
  const row = byDate.get(day.iso)
  if (row) return row.status
  if (day.isWeekend || !day.inMonth || byDate.size === 0) return 'none'
  return 'holiday'
}

/**
 * 05 상태 색상 규약: 휴가·반차 파랑(accent) / 재택·외근·출장 청록(info) / 휴일 연회색 / 결근 빨강.
 * 정상은 칠하지 않는다. 평일의 기본값이 정상이라(10 §1.2) 색을 주면 달력 전체가 회색이 된다.
 * 내 근태 캘린더와 전사 근태 그리드가 같이 쓴다. 칩 색은 `Badge` 의 accent·danger, 홈 캘린더의 휴가 칩과 같다.
 */
export const STATUS_TONE: Partial<Record<CellStatus, string>> = {
  leave: 'bg-accent-soft text-accent',
  half_leave: 'bg-accent-soft text-accent',
  remote: 'bg-info/12 text-info',
  field: 'bg-info/12 text-info',
  trip: 'bg-info/12 text-info',
  holiday: 'bg-sunken text-subtle',
  absent: 'bg-danger/12 text-danger',
}

export function indexByDate(days: AttendanceDay[]): Map<string, AttendanceDay> {
  return new Map(days.map((d) => [d.work_date, d]))
}

/** 180 → "3시간", 90 → "1시간 30분", 0 → "0시간". 연장 누계는 시간 단위가 읽기 쉽다. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}
