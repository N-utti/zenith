import { describe, expect, it } from 'vitest'
import { expiringSoon } from './leaveBalance'

const base = {
  year: 2026,
  granted: 15,
  used: 10,
  remaining: 5,
  grant_basis: 'fiscal_year' as const,
}
const now = new Date(2026, 8, 15) // 2026-09-15

describe('연차 소멸 임박(사용촉진 대상)', () => {
  it('60일 안이면 대상', () => {
    expect(expiringSoon({ ...base, expires_on: '2026-09-15' }, now)).toBe(true)
    expect(expiringSoon({ ...base, expires_on: '2026-10-31' }, now)).toBe(true)
    expect(expiringSoon({ ...base, expires_on: '2026-11-14' }, now)).toBe(true)
  })
  it('60일 밖이거나 이미 지났거나 잔여가 없으면 제외', () => {
    expect(expiringSoon({ ...base, expires_on: '2026-11-15' }, now)).toBe(false)
    expect(expiringSoon({ ...base, expires_on: '2026-12-31' }, now)).toBe(false)
    expect(expiringSoon({ ...base, expires_on: '2026-09-14' }, now)).toBe(false)
    expect(expiringSoon({ ...base, remaining: 0, expires_on: '2026-10-01' }, now)).toBe(false)
  })
})
