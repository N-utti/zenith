import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { CommandPalette } from './CommandPalette'

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: (path: string) =>
    Promise.resolve(
      path === '/channels'
        ? {
            items: [
              { id: 'c-1', name: '개발팀', is_dm: false },
              { id: 'c-2', name: '영업팀', is_dm: false },
              { id: 'c-3', name: '채팅 규칙', is_dm: false },
            ],
          }
        : [
            {
              type: 'doc',
              id: 'd-1',
              title: '개발 문서',
              sub: '',
              snippet: '',
              to: '/docs/d-1',
              at: '2026-09-28T00:00:00Z',
            },
          ],
    ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const auth = {
  user: { id: 'u1', name: '나', role: 'member' },
  status: 'authenticated',
  login: async () => {},
  logout: async () => {},
} as unknown as AuthValue

function Where() {
  return createElement('p', { id: 'where' }, useLocation().pathname)
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  // jsdom 에는 없다. 커서가 움직일 때마다 부른다.
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            MemoryRouter,
            null,
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '*',
                element: [
                  createElement(CommandPalette, { key: 'p', onClose: () => {} }),
                  createElement(Where, { key: 'w' }),
                ],
              }),
            ),
          ),
        ),
      ),
    ),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const input = () => container.querySelector('input')!
const highlighted = () => container.querySelector('button.bg-accent-soft')?.textContent
const where = () => container.querySelector('#where')!.textContent

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input(), text)
  input().dispatchEvent(new Event('input', { bubbles: true }))
}

function press(key: string) {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

/** "개발" 이면 화면 이동은 없고 채팅방 1개, 본문 검색 1개, AI 행 순서다. */
async function search() {
  act(() => type('개발'))
  // 타자가 멈춘 뒤에 검색이 나간다(200ms).
  await vi.waitFor(() => expect(container.textContent).toContain('개발 문서'))
}

test('방 이름을 치면 그 방이 맨 위에 걸리고 Enter 로 들어간다', async () => {
  await search()
  expect(container.textContent).not.toContain('영업팀')
  expect(highlighted()).toContain('개발팀')
  act(() => press('Enter'))
  expect(where()).toBe('/chat/c-1')
})

test('방 아래 본문 검색 결과로 커서가 밀리지 않고 내려간다', async () => {
  await search()
  act(() => press('ArrowDown'))
  expect(highlighted()).toContain('개발 문서')
  act(() => press('Enter'))
  expect(where()).toBe('/docs/d-1')
})

test('화면 이동과 방이 같이 걸리면 방 줄은 화면 이동 다음 칸이다', async () => {
  // "채팅" 은 화면 이동의 "채팅" 과 방 "채팅 규칙" 에 함께 걸린다.
  act(() => type('채팅'))
  await vi.waitFor(() => expect(container.textContent).toContain('채팅 규칙'))
  expect(highlighted()).toContain('채팅')
  act(() => press('ArrowDown'))
  expect(highlighted()).toContain('채팅 규칙')
  act(() => press('Enter'))
  expect(where()).toBe('/chat/c-3')
})
