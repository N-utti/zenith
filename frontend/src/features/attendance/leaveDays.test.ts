import { describe, expect, it } from 'vitest'
import { countWorkdays, leaveDays } from './leaveDays'

describe('연차 차감 일수', () => {
  it('주말을 건너뛴다', () => {
    // 2026-09-04(금) ~ 2026-09-08(화): 금·월·화
    expect(countWorkdays('2026-09-04', '2026-09-08')).toBe(3)
    expect(countWorkdays('2026-09-05', '2026-09-06')).toBe(0)
  })

  it('반차는 기간과 무관하게 0.5, 무급은 0', () => {
    expect(leaveDays({ unit: 'half', deduct_days: 0.5 }, '2026-09-07', '2026-09-07')).toBe(0.5)
    expect(leaveDays({ unit: 'day', deduct_days: 1 }, '2026-09-07', '2026-09-09')).toBe(3)
    expect(leaveDays({ unit: 'day', deduct_days: 0 }, '2026-09-07', '2026-09-09')).toBe(0)
  })
})
