import { afterEach, expect, test, vi } from 'vitest'
import { clearNotifications, restrictImageSources } from './desktop'

vi.mock('./serverOrigin', () => ({ serverOrigin: () => 'https://zenith.example' }))

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

test('데스크톱 앱이면 그림 출처를 앱 자신과 붙은 서버로 좁히고, 브라우저에서는 건드리지 않는다', () => {
  const policy = () => document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')

  restrictImageSources()
  expect(policy()).toBeNull()

  window.__TAURI__ = { core: { invoke: vi.fn() } }
  restrictImageSources()
  expect(policy()?.getAttribute('content')).toBe(
    "img-src 'self' data: blob: https://zenith.example",
  )
  policy()?.remove()
})
