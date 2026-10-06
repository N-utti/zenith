import { afterEach, expect, test, vi } from 'vitest'
import { clearNotifications, restrictImageSources } from './desktop'

const server = vi.hoisted(() => ({ origin: '' }))
vi.mock('./serverOrigin', () => ({ serverOrigin: () => server.origin }))

const policy = () => document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')

afterEach(() => {
  delete window.__TAURI__
  policy()?.remove()
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

test('브라우저에서는 그림 출처 정책을 걸지 않는다', () => {
  server.origin = 'https://zenith.example'
  restrictImageSources()
  expect(policy()).toBeNull()
})

test('데스크톱 앱이면 그림 출처를 앱 자신과 붙은 서버의 오리진으로 좁힌다', () => {
  window.__TAURI__ = { core: { invoke: vi.fn() } }
  server.origin = 'https://zenith.example/zenith'
  restrictImageSources()
  expect(policy()?.getAttribute('content')).toBe("img-src 'self' data: https://zenith.example")
})

test('서버 주소가 주소가 아니면 서버를 빼서 닫힌 쪽으로 둔다', () => {
  window.__TAURI__ = { core: { invoke: vi.fn() } }
  server.origin = '*'
  restrictImageSources()
  expect(policy()?.getAttribute('content')).toBe("img-src 'self' data:")
})
