import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { AuthContext, type AuthValue } from './AuthContext'
import { LoginPage } from './LoginPage'

const startPage = vi.hoisted(() => ({ value: '/chat' }))
/** 켜 두면 로그인이 401 로 실패한다. */
let loginFails = false
vi.mock('@/features/settings/preferences', () => ({
  fetchPreferences: () => Promise.resolve({ start_page: startPage.value }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Where() {
  return createElement('p', { id: 'where' }, useLocation().pathname)
}

/** `login()` 이 프로필을 채우는 순간 상태가 authenticated 로 바뀌는 것까지 실제와 같게 둔다. */
function Auth({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>('anonymous')
  const value: AuthValue = {
    user: null,
    status,
    login: async () => {
      if (loginFails) throw new ApiError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
      setStatus('authenticated')
    },
    logout: async () => {},
  }
  return createElement(AuthContext, { value }, children)
}

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  loginFails = false
})

async function loginFrom(from?: string) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: '/login', state: from ? { from } : null }] },
        createElement(
          Auth,
          null,
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/login', element: createElement(LoginPage) }),
            createElement(Route, { path: '*', element: createElement(Where) }),
          ),
        ),
      ),
    ),
  )
  await act(async () => {
    // 빈 필수 칸 검증을 건너뛰려고 submit 이벤트를 바로 쏜다. 로그인 자체는 가짜라 칸 값은 상관없다.
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => {})
  return container.querySelector('#where')?.textContent
}

test('그냥 로그인하면 고른 시작 화면으로 간다', async () => {
  expect(await loginFrom()).toBe('/chat')
})

test('도메인만 치고 들어와 튕긴 것(`/`)도 그냥 로그인이다', async () => {
  expect(await loginFrom('/')).toBe('/chat')
})

test('보호된 주소에서 튕겼으면 시작 화면보다 그 자리가 먼저다', async () => {
  expect(await loginFrom('/board/b-1')).toBe('/board/b-1')
})

test('실패하면 폼이 다시 살아나고 그 자리에 남는다', async () => {
  loginFails = true
  expect(await loginFrom()).toBeUndefined()
  expect(container.textContent).toContain('이메일 또는 비밀번호가 올바르지 않습니다.')
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false)
})
