import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPanelWidth } from './usePanelWidth'

const KEY = 'test.panelWidth'
const read = () => readPanelWidth(KEY, 300, 220, 480, 0.3)

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readPanelWidth', () => {
  it('저장값이 없거나 숫자가 아니면 기본값', () => {
    expect(read()).toBe(300)
    localStorage.setItem(KEY, 'abc')
    expect(read()).toBe(300)
  })

  it('저장값을 최소·최대와 창 폭 비율 안으로 자른다', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(2000)
    localStorage.setItem(KEY, '100')
    expect(read()).toBe(220)
    localStorage.setItem(KEY, '9999')
    expect(read()).toBe(480)
    // 좁은 창에서는 창 폭의 30% 가 상한이다.
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    expect(read()).toBe(300)
  })

  it('저장소를 못 열면 기본값', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(read()).toBe(300)
  })
})
