import { afterEach, expect, test, vi } from 'vitest'
import { clearNotifications } from './desktop'

afterEach(() => {
  delete window.__TAURI__
  vi.restoreAllMocks()
})

test('데스크톱 앱이면 셸에 알림 센터 비우기를 부탁하고, 실패해도 던지지 않는다', async () => {
  const invoke = vi.fn(() => Promise.reject(new Error('no history')))
  window.__TAURI__ = { core: { invoke } }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  expect(() => clearNotifications()).not.toThrow()
  expect(invoke).toHaveBeenCalledWith('clear_notifications')
  await vi.waitFor(() => expect(warn).toHaveBeenCalled())
})

test('브라우저에서는 아무 일도 하지 않는다', () => {
  expect(() => clearNotifications()).not.toThrow()
})
