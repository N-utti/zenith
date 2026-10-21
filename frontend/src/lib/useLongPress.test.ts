import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useLongPress } from './useLongPress'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Handlers = ReturnType<typeof useLongPress>
type Ev = Parameters<Handlers['onTouchStart']>[0]

const row = document.createElement('a')
const touch = (x: number, y: number, n = 1) =>
  ({
    target: row,
    touches: Array.from({ length: n }, () => ({ clientX: x, clientY: y })),
    preventDefault: vi.fn(),
  }) as unknown as Ev

let root: Root | undefined
let handlers: Handlers
let onPress: ReturnType<typeof vi.fn<(target: Element, x: number, y: number) => boolean>>

beforeEach(() => {
  vi.useFakeTimers()
  onPress = vi.fn(() => true)
  function Probe() {
    handlers = useLongPress(onPress)
    return null
  }
  root = createRoot(document.createElement('div'))
  act(() => root!.render(createElement(Probe)))
})
afterEach(() => {
  act(() => root?.unmount())
  vi.useRealTimers()
})

test('0.5초 누르고 있으면 그 자리로 부르고, 뗄 때 따라오는 클릭을 막는다', () => {
  handlers.onTouchStart(touch(10, 20))
  vi.advanceTimersByTime(499)
  expect(onPress).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(onPress).toHaveBeenCalledWith(row, 10, 20)
  const end = touch(10, 20)
  handlers.onTouchEnd(end)
  expect(end.preventDefault).toHaveBeenCalled()
})

test('짧게 누르면 부르지 않고 클릭은 그대로 간다', () => {
  handlers.onTouchStart(touch(10, 20))
  vi.advanceTimersByTime(200)
  const end = touch(10, 20)
  handlers.onTouchEnd(end)
  vi.advanceTimersByTime(1000)
  expect(onPress).not.toHaveBeenCalled()
  expect(end.preventDefault).not.toHaveBeenCalled()
})

test('누르는 동안 손가락이 움직이면(스크롤) 접는다. 조금 떨리는 건 괜찮다', () => {
  handlers.onTouchStart(touch(10, 20))
  handlers.onTouchMove(touch(14, 23))
  vi.advanceTimersByTime(500)
  expect(onPress).toHaveBeenCalledTimes(1)

  handlers.onTouchEnd(touch(14, 23))
  handlers.onTouchStart(touch(10, 20))
  handlers.onTouchMove(touch(10, 40))
  vi.advanceTimersByTime(1000)
  expect(onPress).toHaveBeenCalledTimes(1)
})

test('두 손가락(확대)은 꾹 누르기가 아니다', () => {
  handlers.onTouchStart(touch(10, 20, 2))
  vi.advanceTimersByTime(1000)
  expect(onPress).not.toHaveBeenCalled()
})

test('줄이 아닌 곳이라 연 게 없으면 클릭을 막지 않는다', () => {
  onPress.mockReturnValue(false)
  handlers.onTouchStart(touch(10, 20))
  vi.advanceTimersByTime(500)
  const end = touch(10, 20)
  handlers.onTouchEnd(end)
  expect(end.preventDefault).not.toHaveBeenCalled()
})
