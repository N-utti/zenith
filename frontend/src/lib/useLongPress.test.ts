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

test('열면 진동하고, 짧게 누르거나 연 게 없으면 진동하지 않는다', () => {
  const vibrate = vi.fn(() => true)
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  try {
    handlers.onTouchStart(touch(10, 20))
    vi.advanceTimersByTime(200)
    handlers.onTouchEnd(touch(10, 20))
    onPress.mockReturnValueOnce(false)
    handlers.onTouchStart(touch(10, 20))
    vi.advanceTimersByTime(500)
    handlers.onTouchEnd(touch(10, 20))
    expect(vibrate).not.toHaveBeenCalled()

    handlers.onTouchStart(touch(10, 20))
    vi.advanceTimersByTime(500)
    expect(vibrate).toHaveBeenCalledTimes(1)
  } finally {
    delete (navigator as { vibrate?: unknown }).vibrate
  }
})

test('누르는 동안 data-long-press 줄이 눌려 들어가고, 접으면 지금 모양에서 돌아온다', () => {
  // jsdom 에는 Web Animations 와 matchMedia 가 없다. 부른 것만 본다.
  const sink = { cancel: vi.fn() }
  const animate = vi.fn<(keyframes: Keyframe[]) => typeof sink>(() => sink)
  const pill = document.createElement('div')
  pill.dataset.longPress = ''
  pill.append(row)
  pill.animate = animate as unknown as typeof pill.animate
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  try {
    handlers.onTouchStart(touch(10, 20))
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'none' }, { transform: 'scale(0.96)' }])
    handlers.onTouchMove(touch(10, 40))
    expect(sink.cancel).toHaveBeenCalled()
    expect(animate.mock.calls[1][0]).toEqual([{ transform: 'none' }, { transform: 'none' }])
  } finally {
    row.remove()
    vi.unstubAllGlobals()
  }
})

test('줄이 아닌 곳이라 연 게 없으면 클릭을 막지 않는다', () => {
  onPress.mockReturnValue(false)
  handlers.onTouchStart(touch(10, 20))
  vi.advanceTimersByTime(500)
  const end = touch(10, 20)
  handlers.onTouchEnd(end)
  expect(end.preventDefault).not.toHaveBeenCalled()
})
