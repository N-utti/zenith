import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysUntil } from './datetime'

/**
 * `daysUntil` 은 시각이 아니라 **날짜** 차이를 센다. 자정을 넘기면 24시간이 안 돼도 하루가 준다.
 * 휴지통의 "n일 뒤 영구 삭제" 가 이 셈법에 매달려 있다.
 *
 * 시각을 `2026-09-17T01:00+09:00` 처럼 고정 오프셋으로 쓰면 안 된다. 이 함수는 **그 기기의**
 * 자정을 기준으로 세는데, 테스트를 도는 곳이 한국이 아니면(CI 는 UTC 다) 같은 문자열이 다른
 * 날짜가 된다. 그래서 날짜·시각을 숫자로 넘겨 언제나 그 기기의 날짜가 되게 만든다.
 */
const local = (year: number, month: number, day: number, hour: number) =>
  new Date(year, month - 1, day, hour)

describe('daysUntil', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('같은 날이면 0 이다', () => {
    vi.setSystemTime(local(2026, 9, 17, 1))
    expect(daysUntil(local(2026, 9, 17, 23).toISOString())).toBe(0)
  })

  it('자정을 넘기면 24시간이 안 돼도 하루로 센다', () => {
    vi.setSystemTime(local(2026, 9, 17, 23))
    expect(daysUntil(local(2026, 9, 18, 1).toISOString())).toBe(1)
  })

  it('이미 지난 시각은 음수가 아니라 0 이다', () => {
    vi.setSystemTime(local(2026, 9, 17, 10))
    expect(daysUntil(local(2026, 9, 10, 10).toISOString())).toBe(0)
  })

  it('30일 뒤는 30 이다', () => {
    vi.setSystemTime(local(2026, 9, 17, 10))
    expect(daysUntil(local(2026, 10, 17, 10).toISOString())).toBe(30)
  })
})
