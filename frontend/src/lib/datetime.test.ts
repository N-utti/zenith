import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysUntil } from './datetime'

/**
 * `daysUntil` 은 시각이 아니라 **날짜** 차이를 센다. 자정을 넘기면 24시간이 안 돼도 하루가 준다.
 * 휴지통의 "n일 뒤 영구 삭제" 가 이 셈법에 매달려 있다.
 */
describe('daysUntil', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  it('같은 날이면 0 이다', () => {
    at('2026-09-17T01:00:00+09:00')
    expect(daysUntil('2026-09-17T23:00:00+09:00')).toBe(0)
  })

  it('자정을 넘기면 24시간이 안 돼도 하루로 센다', () => {
    at('2026-09-17T23:00:00+09:00')
    expect(daysUntil('2026-09-18T01:00:00+09:00')).toBe(1)
  })

  it('이미 지난 시각은 음수가 아니라 0 이다', () => {
    at('2026-09-17T10:00:00+09:00')
    expect(daysUntil('2026-09-10T10:00:00+09:00')).toBe(0)
  })

  it('30일 뒤는 30 이다', () => {
    at('2026-09-17T10:00:00+09:00')
    expect(daysUntil('2026-10-17T10:00:00+09:00')).toBe(30)
  })
})
