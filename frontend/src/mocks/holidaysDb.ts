import type { Holiday, HolidayInput } from '@/features/attendance/types'
import { toISODate } from '@/lib/datetime'
import { isClosedRange } from './closingsDb'

/**
 * 공휴일·회사 휴일(10 §6.1 `holidays`, §9.6 `/admin/holidays`). 근무 달력의 유일한 입력이다.
 * attendanceDb 가 근무일을 셀 때 여기를 본다. 그래서 여기서 바꾸면 근태 달력이 바로 따라온다(§6.2 재생성).
 * 마감된 달의 날짜는 넣고 빼지 못한다(§6.2 "마감됨: 자동 변경하지 않는다").
 * 법정 공휴일은 화면에서 다루지 않는다(2026-09-16). 지우려 하면 403: 원천이 서버다.
 *
 * ponytail: 임시공휴일 지정 때 승인된 연차를 자동 취소·반환하는 §6.2 두 번째 행은 목에 없다. 서버 몫이다.
 */
const holidays = new Map<string, Holiday>()

/** 2026 법정공휴일 시드. 실제로는 exec 가 관보 확정 뒤 연초에 등록한다(SCR-ATT-07). */
for (const [date, name] of Object.entries({
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
})) {
  holidays.set(date, { date, name, kind: 'public' })
}
holidays.set('2026-12-31', { date: '2026-12-31', name: '종무식', kind: 'company' })

type Failure = { error: string; status: number; code: string }
const invalid = (error: string): Failure => ({ error, status: 422, code: 'VALIDATION' })
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 이 화면을 보는 사람이 임원 본인이다. 신청 쪽 문구("임원이 해제해야")를 그대로 쓰면 자기에게 부탁하는 말이 된다. */
const HOLIDAY_MONTH_CLOSED: Failure = {
  error: '마감된 달의 휴일은 바꿀 수 없습니다. 먼저 마감을 해제하세요.',
  status: 409,
  code: 'MONTH_CLOSED',
}

export function isHoliday(isoDate: string): boolean {
  return holidays.has(isoDate)
}

export function listHolidays(year: number): Holiday[] {
  return [...holidays.values()]
    .filter((h) => h.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function addHoliday(input: HolidayInput): { item: Holiday } | Failure {
  // Date.parse 는 2월 30일도 넘긴다. 실제 달력으로 왕복시켜 같은지 본다.
  const [y, m, d] = input.date.split('-').map(Number)
  if (!ISO_DATE.test(input.date) || toISODate(new Date(y, m - 1, d)) !== input.date) {
    return invalid('날짜가 올바르지 않습니다.')
  }
  const name = input.name?.trim() ?? ''
  if (!name || name.length > 100) return invalid('이름은 1~100자입니다.')
  if (input.kind !== 'public' && input.kind !== 'company') return invalid('없는 종류입니다.')
  if (holidays.has(input.date)) {
    return { error: '이미 휴일로 등록된 날짜입니다.', status: 409, code: 'HOLIDAY_EXISTS' }
  }
  if (isClosedRange(input.date)) return HOLIDAY_MONTH_CLOSED
  const item: Holiday = { date: input.date, name, kind: input.kind }
  holidays.set(item.date, item)
  return { item }
}

export function removeHoliday(date: string): 'ok' | 'not_found' | Failure {
  const found = holidays.get(date)
  if (!found) return 'not_found'
  if (found.kind === 'public') {
    return { error: '법정 공휴일은 여기서 지울 수 없습니다.', status: 403, code: 'FORBIDDEN' }
  }
  if (isClosedRange(date)) return HOLIDAY_MONTH_CLOSED
  holidays.delete(date)
  return 'ok'
}
