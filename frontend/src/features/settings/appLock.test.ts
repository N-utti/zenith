import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockNow, readAppLock, setAppLock, unlockAppLock, useAutoLock } from './appLock'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('잠금 모드', () => {
  it('번호가 틀리면 그대로 잠겨 있고, 맞으면 풀린다. 사람마다 따로다', () => {
    setAppLock('a', { pin: '1234', idleMinutes: 0, locked: false })
    lockNow('a')
    lockNow('b') // 잠금 모드를 안 켠 사람은 잠기지 않는다.
    expect(readAppLock('a')?.locked).toBe(true)
    expect(readAppLock('b')).toBeNull()

    expect(unlockAppLock('a', '0000')).toBe(false)
    expect(readAppLock('a')?.locked).toBe(true)
    expect(unlockAppLock('a', '1234')).toBe(true)
    expect(readAppLock('a')?.locked).toBe(false)
  })

  it('정한 시간 동안 손대지 않으면 잠기고, 그 전에 손대면 다시 센다', () => {
    vi.useFakeTimers()
    setAppLock('a', { pin: '1234', idleMinutes: 5, locked: false })
    function Probe() {
      useAutoLock('a', readAppLock('a'))
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))

    vi.advanceTimersByTime(4 * 60_000)
    window.dispatchEvent(new KeyboardEvent('keydown'))
    vi.advanceTimersByTime(4 * 60_000)
    expect(readAppLock('a')?.locked).toBe(false)

    vi.advanceTimersByTime(60_000 + 10_000)
    expect(readAppLock('a')?.locked).toBe(true)
    act(() => root.unmount())
  })

  it('오래 손대지 않다가 켜도 바로 잠그지 않는다. 켠 때부터 센다', () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(30 * 60_000) // 잠금 모드를 켜기 전 30분. 그동안은 손댄 시각을 세지 않는다.
    setAppLock('a', { pin: '1234', idleMinutes: 10, locked: false })
    function Probe() {
      useAutoLock('a', readAppLock('a'))
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))

    vi.advanceTimersByTime(20_000)
    expect(readAppLock('a')?.locked).toBe(false)
    vi.advanceTimersByTime(10 * 60_000)
    expect(readAppLock('a')?.locked).toBe(true)
    act(() => root.unmount())
  })
})
