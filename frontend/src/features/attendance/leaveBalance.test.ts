import { describe, expect, it } from 'vitest'
import { leavePromotion } from './leaveBalance'

const base = {
  year: 2026,
  granted: 15,
  used: 10,
  remaining: 5,
  expires_on: '2026-12-31',
  grant_basis: 'fiscal_year' as const,
}
const on = (month: number, day: number) => leavePromotion(base, new Date(2026, month - 1, day))

describe('연차 사용촉진 단계(근로기준법 61조)', () => {
  it('소멸 6개월 전까지는 대상이 아니다', () => {
    expect(on(6, 30)).toBeNull()
  })
  it('1차 촉구는 소멸 6개월 전부터 10일', () => {
    expect(on(7, 1)).toEqual({ stage: 'first', due: '2026-07-10', urgent: true })
    expect(on(7, 10)).toEqual({ stage: 'first', due: '2026-07-10', urgent: true })
  })
  it('그 뒤는 2차 통보, 기한은 소멸 2개월 전. 30일 남으면 챙길 사람', () => {
    expect(on(7, 11)).toEqual({ stage: 'second', due: '2026-10-31', urgent: false })
    expect(on(9, 30)).toEqual({ stage: 'second', due: '2026-10-31', urgent: false })
    expect(on(10, 1)).toEqual({ stage: 'second', due: '2026-10-31', urgent: true })
    expect(on(10, 31)).toEqual({ stage: 'second', due: '2026-10-31', urgent: true })
  })
  it('2차 기한이 지나면 소멸 예정, 소멸일까지', () => {
    expect(on(11, 1)).toEqual({ stage: 'expiring', due: '2026-12-31', urgent: true })
    expect(on(12, 31)).toEqual({ stage: 'expiring', due: '2026-12-31', urgent: true })
  })
  it('잔여가 없거나 이미 소멸했으면 제외', () => {
    expect(leavePromotion({ ...base, remaining: 0 }, new Date(2026, 9, 14))).toBeNull()
    expect(leavePromotion(base, new Date(2027, 0, 1))).toBeNull()
  })
  it('옮긴 달에 그 날이 없으면 말일로 당긴다(입사일 기준 부여)', () => {
    // 4월 29일 소멸: 다음 날 4월 30일의 두 달 전은 2월 30일이 아니라 28일, 기한은 그 전날.
    const balance = { ...base, expires_on: '2027-04-29', grant_basis: 'hire_date' as const }
    expect(leavePromotion(balance, new Date(2027, 1, 1))).toEqual({
      stage: 'second',
      due: '2027-02-27',
      urgent: true,
    })
    // 8월 30일 소멸: 다음 날 8월 31일의 여섯 달 전은 2월 31일이 아니라 28일.
    expect(leavePromotion({ ...balance, expires_on: '2027-08-30' }, new Date(2027, 1, 28))).toEqual(
      { stage: 'first', due: '2027-03-09', urgent: true },
    )
  })
  it('1차 시작이 해를 넘겨도 맞다', () => {
    const balance = { ...base, expires_on: '2027-03-31' }
    expect(leavePromotion(balance, new Date(2026, 8, 30))).toBeNull()
    expect(leavePromotion(balance, new Date(2026, 9, 1))?.stage).toBe('first')
  })
})
