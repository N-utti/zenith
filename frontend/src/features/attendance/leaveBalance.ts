import { toISODate } from '@/lib/datetime'
import type { LeaveBalance } from './types'

/** 사용촉진 시점(FR-ATT-23)의 D-60. 소멸 60일 전부터 경고하고 관리 표에서도 대상자로 표시한다. */
export const EXPIRING_WINDOW_DAYS = 60

/** 소멸 60일 안이고 잔여가 남아 있으면 참. 날짜는 ISO 문자열끼리 비교한다. 파싱하면 시간대에 밀린다. */
export function expiringSoon(balance: LeaveBalance, now = new Date()): boolean {
  const today = toISODate(now)
  const limit = toISODate(new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000))
  return balance.remaining > 0 && balance.expires_on >= today && balance.expires_on <= limit
}
