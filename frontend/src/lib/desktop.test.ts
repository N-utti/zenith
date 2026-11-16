import { afterEach, expect, test, vi } from 'vitest'
import {
  clearNotifications,
  findUpdate,
  installExternalLinkHandler,
  installUpdate,
  openExternal,
  restrictImageSources,
} from './desktop'

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

test('데스크톱 앱이면 바깥 링크의 왼쪽 클릭과 휠 클릭을 기본 브라우저로 넘기고, 오른쪽 클릭은 두지 않는다', () => {
  const invoke = vi.fn(() => Promise.resolve())
  window.__TAURI__ = { core: { invoke } }
  const off = installExternalLinkHandler()
  const link = document.createElement('a')
  link.href = 'https://www.korea.kr/news/1'
  document.body.append(link)
  try {
    for (const [type, button] of [
      ['click', 0],
      ['auxclick', 1],
      ['auxclick', 2],
    ] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(button !== 2)
    }
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://www.korea.kr/news/1',
      with: null,
    })
  } finally {
    off()
    link.remove()
  }
})

test('바깥 주소 열기: 데스크톱 앱은 기본 브라우저로, 브라우저는 새 탭으로', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  openExternal('https://example.com/')
  expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener')

  const invoke = vi.fn(() => Promise.resolve())
  window.__TAURI__ = { core: { invoke } }
  open.mockClear()
  openExternal('https://example.com/')
  expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
    url: 'https://example.com/',
    with: null,
  })
  expect(open).not.toHaveBeenCalled()
})

test('새 버전이 있으면 번호를, 없거나 확인하지 못하면 null 을 돌려준다', async () => {
  server.origin = 'https://zenith.example'
  expect(await findUpdate()).toBeNull() // 브라우저: 셸이 없다

  const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()
  window.__TAURI__ = { core: { invoke } }
  invoke.mockResolvedValueOnce('0.1.1')
  expect(await findUpdate()).toBe('0.1.1')
  expect(invoke).toHaveBeenCalledWith('check_update', { origin: 'https://zenith.example' })

  invoke.mockResolvedValueOnce(null) // 이미 최신
  expect(await findUpdate()).toBeNull()

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  invoke.mockRejectedValueOnce(new Error('매니페스트 없음'))
  expect(await findUpdate()).toBeNull()
  expect(warn).toHaveBeenCalled()

  server.origin = '' // 개발 모드: 서버 주소를 모른다
  invoke.mockClear()
  expect(await findUpdate()).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

test('설치는 셸에 맡기고, 실패는 부른 쪽이 알게 던진다', async () => {
  const invoke = vi.fn(() => Promise.reject(new Error('받지 못함')))
  window.__TAURI__ = { core: { invoke } }
  await expect(installUpdate()).rejects.toThrow('받지 못함')
  expect(invoke).toHaveBeenCalledWith('install_update')
})
