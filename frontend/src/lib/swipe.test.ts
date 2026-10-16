import { describe, expect, it } from 'vitest'
import { swipeStep } from './swipe'

describe('swipeStep', () => {
  it('왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전', () => {
    expect(swipeStep(-80, 5)).toBe(1)
    expect(swipeStep(80, -5)).toBe(-1)
  })

  it('짧게 밀린 건 누름으로 본다', () => {
    expect(swipeStep(-30, 0)).toBe(0)
    expect(swipeStep(-49, 0)).toBe(0)
    expect(swipeStep(-50, 0)).toBe(1)
  })

  it('가로가 세로의 1.5배면 넘긴다', () => {
    expect(swipeStep(-75, 50)).toBe(1)
  })

  it('세로 스크롤이 섞이면 넘기지 않는다', () => {
    expect(swipeStep(-80, 70)).toBe(0)
  })
})
