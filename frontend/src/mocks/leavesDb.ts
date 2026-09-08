import type {
  LeaveBalance,
  LeaveRequest,
  LeaveRequestInput,
  LeaveType,
} from '@/features/attendance/types'
import { leaveDays } from '@/features/attendance/leaveDays'
import type { User } from '@/types'

/** 10 근태 설계서 §4.1 `leave_types` 시드. */
export const LEAVE_TYPES: LeaveType[] = [
  { code: 'annual', name: '연차', paid: true, deduct_days: 1, unit: 'day' },
  { code: 'half_am', name: '오전 반차', paid: true, deduct_days: 0.5, unit: 'half' },
  { code: 'half_pm', name: '오후 반차', paid: true, deduct_days: 0.5, unit: 'half' },
  { code: 'sick', name: '병가', paid: true, deduct_days: 0, unit: 'day' },
  { code: 'family', name: '경조사', paid: true, deduct_days: 0, unit: 'day' },
  { code: 'official', name: '공가', paid: true, deduct_days: 0, unit: 'day' },
  { code: 'unpaid', name: '무급 휴가', paid: false, deduct_days: 0, unit: 'day' },
]

const YEAR = new Date().getFullYear()
/** 부여 기준(입사일/회계연도)은 10 §5.4 I5 미결. 목은 1/1 일괄 15일로 둔다. */
const GRANTED = 15

const requests = new Map<string, LeaveRequest[]>()
let seq = 1

function listFor(user: User): LeaveRequest[] {
  let list = requests.get(user.id)
  if (!list) {
    // 첫 진입에 승인된 연차 하나·대기 중 반차 하나가 있어야 목록과 잔여가 살아 보인다.
    list = [
      {
        id: `lv-${seq++}`,
        type_code: 'annual',
        start_date: `${YEAR}-03-02`,
        end_date: `${YEAR}-03-03`,
        days: 2,
        reason: '개인 사정',
        status: 'approved',
        created_at: new Date(YEAR, 1, 20).toISOString(),
        decided_at: new Date(YEAR, 1, 21).toISOString(),
      },
      {
        id: `lv-${seq++}`,
        type_code: 'half_pm',
        start_date: `${YEAR}-09-18`,
        end_date: `${YEAR}-09-18`,
        days: 0.5,
        reason: '병원 진료',
        status: 'pending',
        created_at: new Date(Date.now() - 3_600_000).toISOString(),
        decided_at: null,
      },
    ]
    requests.set(user.id, list)
  }
  return list
}

/** 잔여는 컬럼이 아니라 신청 합계다(10 §4.2.5). 대기분도 잡아 두어 같은 연차를 두 번 신청하지 못하게 한다. */
export function leaveBalance(user: User): LeaveBalance {
  const used = listFor(user)
    .filter((r) => r.status === 'approved' || r.status === 'pending')
    .reduce((sum, r) => sum + r.days, 0)
  return {
    year: YEAR,
    granted: GRANTED,
    used,
    remaining: GRANTED - used,
    expires_on: `${YEAR}-12-31`,
    grant_basis: 'fiscal_year',
  }
}

export function listLeaves(user: User): LeaveRequest[] {
  return [...listFor(user)].sort((a, b) => b.start_date.localeCompare(a.start_date))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function createLeave(
  user: User,
  input: LeaveRequestInput,
): { leave: LeaveRequest } | { error: string; status: number; code: string } {
  const type = LEAVE_TYPES.find((t) => t.code === input.type_code)
  if (!type) return { error: '없는 휴가 종류입니다.', status: 422, code: 'VALIDATION' }
  const start = input.start_date
  const end = type.unit === 'half' ? start : input.end_date
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || end < start) {
    return { error: '기간이 올바르지 않습니다.', status: 422, code: 'VALIDATION' }
  }
  if (!input.reason?.trim()) {
    return { error: '사유를 입력해 주세요.', status: 422, code: 'VALIDATION' }
  }
  const days = leaveDays(type, start, end)
  if (days > leaveBalance(user).remaining) {
    // 04 §10.2: 잔여 부족 422. code 는 04 에 없어 프론트 가정(PR 본문).
    return { error: '잔여 연차가 부족합니다.', status: 422, code: 'LEAVE_INSUFFICIENT' }
  }
  const leave: LeaveRequest = {
    id: `lv-${seq++}`,
    type_code: type.code,
    start_date: start,
    end_date: end,
    days,
    reason: input.reason.trim(),
    status: 'pending',
    created_at: new Date().toISOString(),
    decided_at: null,
  }
  listFor(user).push(leave)
  return { leave }
}

export function cancelLeave(user: User, id: string): LeaveRequest | 'not_found' | 'conflict' {
  const leave = listFor(user).find((r) => r.id === id)
  if (!leave) return 'not_found'
  if (leave.status !== 'pending') return 'conflict'
  leave.status = 'canceled'
  leave.decided_at = new Date().toISOString()
  return leave
}
