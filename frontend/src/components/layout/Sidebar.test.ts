import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ToastContext, type ToastApi } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { chatKeys } from '@/features/chat/api'
import { ChatSocketContext } from '@/features/chat/ChatSocketContext'
import type { ChatSocket } from '@/features/chat/useChatSocket'
import type { ChatChannel } from '@/features/chat/types'
import { ChannelSection } from './Sidebar'

// 근무 상태 칩이 오늘 예외 근무를 묻는다. 여기서는 아무도 없다고 답한다.
const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const auth = { user: { id: 'me', name: '나' }, status: 'authenticated' } as unknown as AuthValue
const room = (id: string, extra: Partial<ChatChannel> = {}) =>
  ({
    id,
    name: id,
    is_dm: false,
    is_private: false,
    members: [],
    unread: 0,
    last_message: null,
    can_delete: false,
    created_by: null,
    ...extra,
  }) as ChatChannel

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() } satisfies ToastApi
const sendRead = vi.fn()

let root: Root | undefined
afterEach(() => act(() => root?.unmount()))

/** `/chat/c-2` 를 보고 있는 사이드바의 채널·DM 구획. */
function render(online: ReadonlySet<string> = new Set()) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(chatKeys.channels, {
    items: [
      room('c-1'),
      room('c-2'),
      room('c-3', { unread: 2, can_delete: true }),
      room('d-1', {
        is_dm: true,
        members: [
          { id: 'me', name: '나' },
          { id: 'u-2', name: '정성운' },
        ] as ChatChannel['members'],
      }),
    ],
  })
  const container = document.createElement('div')
  root = createRoot(container)
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            ChatSocketContext,
            { value: { online, sendRead, connected: true } as unknown as ChatSocket },
            createElement(
              ToastContext,
              { value: toast },
              createElement(
                MemoryRouter,
                { initialEntries: ['/chat/c-2'] },
                createElement(ChannelSection),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  return container
}

const rooms = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
const label = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!

test('채널 구획을 접으면 안 읽은 방과 보고 있는 방만 남고, 다시 그려도 접혀 있다', () => {
  api.mockResolvedValue({ items: [] })
  const first = render()
  expect(rooms(first)).toEqual(['/chat/c-1', '/chat/c-2', '/chat/c-3', '/chat/d-1'])

  act(() => label(first, '채널').click())
  // c-1 만 빠진다. c-2 는 보고 있는 방, c-3 은 안 읽은 방, d-1 은 접지 않은 DM 구획이다.
  expect(rooms(first)).toEqual(['/chat/c-2', '/chat/c-3', '/chat/d-1'])
  expect(label(first, '채널').getAttribute('aria-expanded')).toBe('false')
  expect(localStorage.getItem('zenith.sidebarSectionsCollapsed')).toBe('["channels"]')

  // 편집 화면을 드나들 때처럼 사이드바가 새로 마운트돼도 접힘이 남는다.
  act(() => root!.unmount())
  expect(rooms(render())).toEqual(['/chat/c-2', '/chat/c-3', '/chat/d-1'])
})

test('DM 상대가 접속해 있으면 그 줄에 초록 점이 붙는다', () => {
  api.mockResolvedValue({ items: [] })
  const dot = (container: HTMLElement) =>
    container.querySelector('a[href="/chat/d-1"] [aria-label="접속 중"]')
  expect(dot(render())).toBeNull()
  act(() => root!.unmount())
  expect(dot(render(new Set(['u-2'])))).not.toBeNull()
})

// jsdom 에는 없다. 메뉴가 구르는 영역을 찾을 때 쓴다.
document.elementsFromPoint = () => []

/** `href` 줄을 우클릭해 뜬 메뉴의 항목 이름들. */
function rightClick(container: HTMLElement, href: string) {
  const row = container.querySelector(`a[href="${href}"]`)!
  act(() =>
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })),
  )
  return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[]
}

test('DM 줄을 우클릭하면 목록에서 숨기기 메뉴가 뜨고, 고르면 숨기기를 보낸다', async () => {
  api.mockResolvedValue({ items: [] })
  const container = render()
  const items = rightClick(container, '/chat/d-1')
  // 안 읽은 게 없는 방이라 읽음 표시는 없다.
  expect(items.map((item) => item.textContent)).toEqual(['목록에서 숨기기'])

  act(() => items[0].click())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  // 메뉴를 고른 클릭이 줄까지 올라가 그 방을 열지 않는다. 숨긴 뒤 목록을 다시 받기 전에 본다.
  expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/chat/c-2')
  await act(async () => {})
  expect(api).toHaveBeenCalledWith('/channels/d-1/hide', { method: 'POST' })
})

test('안 읽은 방은 우클릭 메뉴에 읽음으로 표시가 있고, 고르면 소켓으로 읽음을 보낸다', () => {
  api.mockResolvedValue({ items: [] })
  const items = rightClick(render(), '/chat/c-3')
  expect(items.map((item) => item.textContent)).toEqual([
    '읽음으로 표시',
    '이름 바꾸기',
    '채널 지우기',
  ])
  act(() => items[0].click())
  expect(sendRead).toHaveBeenCalledWith('c-3')
})

test('메뉴에서 이름 바꾸기를 고르면 메뉴만 닫히고 창이 뜬다', () => {
  api.mockResolvedValue({ items: [] })
  const items = rightClick(render(), '/chat/c-2')
  act(() => items.find((item) => item.textContent === '이름 바꾸기')!.click())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('채널 이름 바꾸기')
})

test('채널을 지우면 목록을 다시 받기 전에 확인 창이 닫힌다', async () => {
  // 지우기 뒤 목록 다시 받기는 끝나지 않는다. 줄이 남아 있어도 창은 닫혀야 한다.
  api.mockImplementation((_path: string, init?: RequestInit) =>
    init?.method === 'DELETE' ? Promise.resolve() : new Promise(() => {}),
  )
  const items = rightClick(render(), '/chat/c-3')
  act(() => items.find((item) => item.textContent === '채널 지우기')!.click())
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
    (b) => b.textContent === '지우기',
  ) as HTMLElement
  await act(async () => confirm.click())
  expect(api).toHaveBeenCalledWith('/channels/c-3', { method: 'DELETE' })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(toast.success).toHaveBeenCalledWith('c-3 채널을 지웠습니다.')
})
