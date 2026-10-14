import { toISODate } from '@/lib/datetime'
import type { LeaveBalance } from './types'

/** 2차 통보 기한이 이만큼 남으면 챙길 사람으로 올린다. 법이 정한 수가 아니라 화면이 두는 여유다. */
export const SECOND_NOTICE_WARN_DAYS = 30

/**
 * 연차 사용촉진의 지금 단계(근로기준법 61조 1항, FR-ATT-23).
 * - `first`: 1차 촉구. 소멸 6개월 전부터 10일 안에 남은 일수를 알리고 사용 시기를 정해 달라고 한다.
 * - `second`: 2차 통보. 직원이 시기를 정하지 않으면 소멸 2개월 전까지 회사가 시기를 정해 알린다.
 * - `expiring`: 2차 기한이 지났고 소멸만 남았다.
 *
 * `due` 는 그 단계의 기한(`expiring` 은 소멸일), `urgent` 는 지금 챙겨야 하는지다.
 */
export interface LeavePromotion {
  stage: 'first' | 'second' | 'expiring'
  due: string
  urgent: boolean
}

/** ISO 날짜에 달과 일을 더한다. 옮긴 달에 그 날이 없으면 말일로 당긴다(기한이 이른 쪽으로 잡힌다). UTC 로만 셈해 시간대에 밀리지 않는다. */
function shiftDate(iso: string, months: number, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay) + days))
    .toISOString()
    .slice(0, 10)
}

/**
 * 잔여가 없거나 이미 소멸했거나 1차 시기 전이면 `null`. 날짜는 ISO 문자열끼리 비교한다.
 *
 * 12월 31일 소멸이면 1차가 7월 1일~10일, 2차 기한이 10월 31일이다. 소멸 다음 날에서 달을 빼야 이렇게 떨어진다.
 * 통지를 실제로 했는지는 서버에 기록이 없어 모른다. 여기서 아는 것은 시점뿐이다.
 * 입사 1년 미만의 월 단위 연차(61조 2항, 3개월·1개월 전)는 서버가 따로 주지 않아 다루지 않는다.
 */
export function leavePromotion(balance: LeaveBalance, now = new Date()): LeavePromotion | null {
  const today = toISODate(now)
  if (balance.remaining <= 0 || balance.expires_on < today) return null
  const end = shiftDate(balance.expires_on, 0, 1)
  const firstStart = shiftDate(end, -6, 0)
  if (today < firstStart) return null
  const firstDue = shiftDate(firstStart, 0, 9)
  if (today <= firstDue) return { stage: 'first', due: firstDue, urgent: true }
  const secondDue = shiftDate(shiftDate(end, -2, 0), 0, -1)
  if (today <= secondDue) {
    const urgent = today >= shiftDate(secondDue, 0, -SECOND_NOTICE_WARN_DAYS)
    return { stage: 'second', due: secondDue, urgent }
  }
  return { stage: 'expiring', due: balance.expires_on, urgent: true }
}
