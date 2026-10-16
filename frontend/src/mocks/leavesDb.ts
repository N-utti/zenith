import { isClosedRange, MONTH_CLOSED } from './closingsDb'
import type {
  LeaveBalance,
  LeaveBalanceRow,
  LeaveOnCalendar,
  LeaveRequest,
  LeaveRequestInput,
  LeaveType,
} from '@/features/attendance/types'
import { leaveDays } from '@/features/attendance/leaveDays'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { MOCK_USERS } from './db'

/**
 * 10 근태 설계서 §4.1 `leave_types` 시드. 무급 휴가(`unpaid`)는 뺐다. 직원이 폼에서 고르는
 * 항목이 아니라 인사가 처리하는 예외라서다(2026-09-08 결정). 스키마의 `paid` 는 그대로 둔다.
 */
export const LEAVE_TYPES: LeaveType[] = [
  { code: 'annual', name: '연차', paid: true, deduct_days: 1, unit: 'day' },
  {
    code: 'half_am',
    name: '오전 반차',
    paid: true,
    deduct_days: 0.5,
    unit: 'half',
  },
  {
    code: 'half_pm',
    name: '오후 반차',
    paid: true,
    deduct_days: 0.5,
    unit: 'half',
  },
  { code: 'sick', name: '병가', paid: true, deduct_days: 0, unit: 'day' },
  { code: 'family', name: '경조사', paid: true, deduct_days: 0, unit: 'day' },
  { code: 'official', name: '공가', paid: true, deduct_days: 0, unit: 'day' },
]

const YEAR = new Date().getFullYear()
/** 부여 기준(입사일/회계연도)은 10 §5.4 I5 미결. 목은 1/1 일괄 15일로 둔다. */
const GRANTED = 15

const requests = new Map<string, LeaveRequest[]>()
let seq = 1

/** 오늘에서 n일 뒤의 평일. 주말에 걸리면 다음 월요일. 목 휴가가 토·일에 찍히면 버그처럼 보인다. */
function workday(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  return toISODate(date)
}

/**
 * 입사일 기준 부여자 한 명. 소멸일이 연말이 아니라 곧이라 연차 관리 탭의 사용촉진 대상 표시가 보인다.
 * 실제 기준(I5)은 미결이고 목에서 두 기준이 섞여 있어도 잔여 계산은 같다.
 */
const HIRE_DATE_BASIS: Record<string, string> = { 'u-7': workday(40) }

/**
 * 홈 캘린더(전 직원 휴가)가 비어 보이지 않게 오늘 언저리에 깔아 두는 남의 휴가.
 * 기본 시드(아래 `listFor`)에 얹히므로 이 사람으로 로그인해도 근태 화면의 데모 데이터는 그대로다.
 */
const EXTRA_SEEDS: Array<
  [userId: string, type: string, start: string, end: string, status: LeaveRequest['status']]
> = [
  ['u-6', 'annual', workday(2), workday(3), 'approved'],
  ['u-5', 'half_am', workday(-1), workday(-1), 'approved'],
  ['u-7', 'annual', workday(8), workday(12), 'approved'],
  ['u-3', 'official', workday(1), workday(1), 'approved'],
  ['u-8', 'annual', workday(-6), workday(-5), 'approved'],
  ['u-9', 'sick', workday(5), workday(5), 'pending'],
  // 폰 캘린더는 옆으로 밀어 지난달·다음 달을 넘겨 본다. 앞뒤 달도 비지 않게 한 달 남짓 거리에 깐다.
  ['u-8', 'annual', workday(-38), workday(-36), 'approved'],
  ['u-6', 'half_pm', workday(-24), workday(-24), 'approved'],
  ['u-3', 'annual', workday(-17), workday(-17), 'approved'],
  ['u-9', 'annual', workday(20), workday(21), 'approved'],
  ['u-5', 'official', workday(28), workday(28), 'approved'],
  ['u-6', 'annual', workday(36), workday(37), 'approved'],
]

function extraSeeds(user: User): LeaveRequest[] {
  return EXTRA_SEEDS.filter(([id]) => id === user.id).map(([, type_code, start, end, status]) => ({
    id: `lv-${seq++}`,
    type_code,
    start_date: start,
    end_date: end,
    days: leaveDays(
      LEAVE_TYPES.find((t) => t.code === type_code) ?? {
        unit: 'day',
        deduct_days: 0,
      },
      start,
      end,
    ),
    reason: '',
    status,
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    decided_at: status === 'pending' ? null : new Date(Date.now() - 4 * 86_400_000).toISOString(),
  }))
}

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
      ...extraSeeds(user),
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
  const hireBasis = HIRE_DATE_BASIS[user.id]
  return {
    year: YEAR,
    granted: GRANTED,
    used,
    remaining: GRANTED - used,
    expires_on: hireBasis ?? `${YEAR}-12-31`,
    grant_basis: hireBasis ? 'hire_date' : 'fiscal_year',
  }
}

/** 전 직원의 연차 잔여(연차 관리 탭). 권한 판정은 핸들러가 한다. */
export function listBalances(): LeaveBalanceRow[] {
  return MOCK_USERS.map((user) => ({
    user: { id: user.id, name: user.name, role: user.role, team: user.team },
    ...leaveBalance(user),
  }))
}

export function listLeaves(user: User): LeaveRequest[] {
  return [...listFor(user)].sort((a, b) => b.start_date.localeCompare(a.start_date))
}

/** 기간이 겹치는 전 직원의 승인 휴가. 전 직원을 훑어야 아직 근태 화면을 안 연 사람의 것도 나온다. */
/**
 * 홈 캘린더의 전사 휴가. 남의 휴가는 종류를 `leave` 로 가린다. 본인과 임원만 원래 종류를 본다
 * (병가·경조사는 남에게 알릴 일이 아니다, 백엔드 #316).
 */
export function listLeavesInRange(viewer: User, from: string, to: string): LeaveOnCalendar[] {
  return MOCK_USERS.flatMap((user) =>
    listFor(user)
      .filter((r) => r.status === 'approved' && r.start_date <= to && r.end_date >= from)
      .map((r) => ({
        id: r.id,
        user: { id: user.id, name: user.name },
        type_code: user.id === viewer.id || viewer.role === 'exec' ? r.type_code : 'leave',
        start_date: r.start_date,
        end_date: r.end_date,
      })),
  )
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function createLeave(
  user: User,
  input: LeaveRequestInput,
): { leave: LeaveRequest } | { error: string; status: number; code: string } {
  const type = LEAVE_TYPES.find((t) => t.code === input.type_code)
  if (!type) return { error: '없는 휴가 종류입니다.', status: 422, code: 'VALIDATION' }
  const start = input.start_date
  const end = type.unit === 'half' ? start : input.end_date
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || end < start) {
    return {
      error: '기간이 올바르지 않습니다.',
      status: 422,
      code: 'VALIDATION',
    }
  }
  // 사유는 차감 없는 휴가(병가·경조사·공가)에만 필수. 연차·반차는 받지 않는다.
  if (type.deduct_days === 0 && !input.reason?.trim()) {
    return { error: '사유를 입력해 주세요.', status: 422, code: 'VALIDATION' }
  }
  // 마감된 달에는 신청할 수 없다(10 §5.5, TC-ATT-16).
  if (isClosedRange(start, end)) return MONTH_CLOSED
  const days = leaveDays(type, start, end)
  if (days > leaveBalance(user).remaining) {
    // 04 §10.2: 잔여 부족 422. code 는 04 에 없어 프론트 가정(PR 본문).
    return {
      error: '잔여 연차가 부족합니다.',
      status: 422,
      code: 'LEAVE_INSUFFICIENT',
    }
  }
  const leave: LeaveRequest = {
    id: `lv-${seq++}`,
    type_code: type.code,
    start_date: start,
    end_date: end,
    days,
    reason: input.reason?.trim() ?? '',
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
