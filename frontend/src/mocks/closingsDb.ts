import type { MonthClosing } from '@/features/attendance/types'
import { currentMonth, shiftMonth } from '@/lib/datetime'
import type { User } from '@/types'
import { MOCK_USERS } from './db'

/**
 * 월 마감(10 §5.5 `att_days.locked_at`, §9.5 close·reopen). 달 단위 상태와 마감·해제 이력만 든다.
 * 다른 목(휴가·예외 근무)이 신청 기간이 마감된 달에 걸치는지 여기에 묻는다(TC-ATT-16, 409).
 * 잠그는 건 생성뿐이다. 대기 중 신청의 취소는 확정 집계를 바꾸지 않아 막지 않는다.
 * attendanceDb 와 leavesDb 가 서로를 이미 import 해서, 둘 다 읽는 이 모듈은 따로 뗐다.
 */
const closings = new Map<string, MonthClosing>()

type Failure = { error: string; status: number; code: string }

function byOf(user: User) {
  return { id: user.id, name: user.name }
}

/** 데모용: 지난달은 임원이 마감해 둔 상태로 시작한다. */
{
  const exec = MOCK_USERS.find((u) => u.role === 'exec')
  if (exec) {
    const month = shiftMonth(currentMonth(), -1)
    const at = new Date(Date.now() - 5 * 86_400_000).toISOString()
    closings.set(month, {
      month,
      status: 'closed',
      closed_at: at,
      closed_by: byOf(exec),
      history: [{ action: 'close', at, by: byOf(exec) }],
    })
  }
}

export function getClosing(month: string): MonthClosing {
  return (
    closings.get(month) ?? { month, status: 'open', closed_at: null, closed_by: null, history: [] }
  )
}

/** 한 해 열두 달. 마감 화면이 표로 훑는다. */
export function listClosings(year: number): MonthClosing[] {
  return Array.from({ length: 12 }, (_, i) =>
    getClosing(`${year}-${String(i + 1).padStart(2, '0')}`),
  )
}

/** `start`~`end`(ISO 날짜) 기간이 마감된 달을 하나라도 지나는지. 양끝만 보면 석 달짜리 출장의 가운데 달이 샌다. */
export function isClosedRange(start: string, end: string = start): boolean {
  const [from, to] = [start.slice(0, 7), end.slice(0, 7)]
  for (const [m, c] of closings) if (c.status === 'closed' && m >= from && m <= to) return true
  return false
}

export const MONTH_CLOSED: Failure = {
  error: '마감된 달입니다. 신청하려면 임원이 마감을 해제해야 합니다.',
  status: 409,
  code: 'MONTH_CLOSED',
}

export function closeMonth(user: User, month: string): { item: MonthClosing } | Failure {
  if (month > currentMonth()) {
    return { error: '아직 오지 않은 달은 마감할 수 없습니다.', status: 422, code: 'VALIDATION' }
  }
  const current = getClosing(month)
  if (current.status === 'closed') {
    return { error: '이미 마감된 달입니다.', status: 409, code: 'ALREADY_CLOSED' }
  }
  const at = new Date().toISOString()
  const item: MonthClosing = {
    month,
    status: 'closed',
    closed_at: at,
    closed_by: byOf(user),
    history: [{ action: 'close', at, by: byOf(user) }, ...current.history],
  }
  closings.set(month, item)
  return { item }
}

export function reopenMonth(
  user: User,
  month: string,
  reason: string,
): { item: MonthClosing } | Failure {
  const current = getClosing(month)
  if (current.status !== 'closed') {
    return { error: '마감되지 않은 달입니다.', status: 409, code: 'NOT_CLOSED' }
  }
  if (!reason?.trim()) {
    return { error: '해제 사유를 입력해 주세요.', status: 422, code: 'VALIDATION' }
  }
  const item: MonthClosing = {
    month,
    status: 'open',
    closed_at: null,
    closed_by: null,
    history: [
      { action: 'reopen', at: new Date().toISOString(), by: byOf(user), reason: reason.trim() },
      ...current.history,
    ],
  }
  closings.set(month, item)
  return { item }
}
