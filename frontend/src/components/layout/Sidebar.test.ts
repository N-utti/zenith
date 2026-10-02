import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { chatKeys } from '@/features/chat/api'
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
    ...extra,
  }) as ChatChannel

let root: Root | undefined
afterEach(() => act(() => root?.unmount()))

/** `/chat/c-2` 를 보고 있는 사이드바의 채널·DM 구획. */
function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(chatKeys.channels, {
    items: [room('c-1'), room('c-2'), room('c-3', { unread: 2 }), room('d-1', { is_dm: true })],
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
            MemoryRouter,
            { initialEntries: ['/chat/c-2'] },
            createElement(ChannelSection),
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
