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
/** 스크린리더가 읽는 "지금 고른 줄". 입력칸이 가리키는 옵션과 선택 표시가 같은 줄이어야 한다. */
function highlighted() {
  const selected = container.querySelectorAll('[role="option"][aria-selected="true"]')
  expect(selected).toHaveLength(1)
  expect(input().getAttribute('aria-activedescendant')).toBe(selected[0].id)
  return selected[0].textContent
}
const where = () => container.querySelector('#where')!.textContent

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input(), text)
  input().dispatchEvent(new Event('input', { bubbles: true }))
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  input().dispatchEvent(event)
  return event
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

test('스크린리더에 입력칸이 결과 목록을 조종하는 콤보박스로 보이고, 개수를 알려 준다', async () => {
  const listbox = container.querySelector('[role="listbox"]')!
  expect(input().getAttribute('role')).toBe('combobox')
  expect(input().getAttribute('aria-controls')).toBe(listbox.id)
  // 모든 줄이 목록 안의 옵션이고, 탭 키로 줄마다 멈추지 않는다(포커스는 입력칸에 머문다).
  const options = container.querySelectorAll('[role="option"]')
  expect(options.length).toBeGreaterThan(1)
  for (const option of options) {
    expect(listbox.contains(option)).toBe(true)
    expect(option.getAttribute('tabindex')).toBe('-1')
  }

  await search()
  const live = container.querySelector('[aria-live="polite"]')!
  await vi.waitFor(() => expect(live.textContent).toBe('화면 0개, 채팅방 1개, 검색 결과 1개'))
})

test('Tab 과 Shift+Tab 이 팔레트 밖으로 나가지 않고 입력칸에 머문다', () => {
  // jsdom 은 배치를 안 해서 offsetParent 가 늘 null 이다. 포커스 가둠 훅이 "보이는 요소" 를 가리는 데 쓴다.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement
  })
  expect(document.activeElement).toBe(input())
  expect(press('Tab').defaultPrevented).toBe(true)
  expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(input())
  vi.restoreAllMocks()
})

test('검색어 끝에 공백이 있어도 찾기가 끝나면 개수를 알린다', async () => {
  act(() => type('개발 '))
  const live = container.querySelector('[aria-live="polite"]')!
  await vi.waitFor(() => expect(live.textContent).toBe('화면 0개, 채팅방 1개, 검색 결과 1개'))
})
