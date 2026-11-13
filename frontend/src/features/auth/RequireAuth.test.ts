import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { ToastContext, type ToastApi } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from './AuthContext'
import { RequireAuth } from './RequireAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toast: ToastApi = { success: vi.fn(), error: vi.fn(), info: vi.fn() }

/** 보호된 자리에 앱 대신 표지 하나를 둔다. 표지가 보이면 앱 틀(채팅 소켓 포함)이 마운트된 것이다. */
async function render(mustChange: boolean) {
  const auth = {
    status: 'authenticated',
    user: { id: 'u1', name: '새 사람', must_change_password: mustChange },
    logout: vi.fn(),
  } as unknown as AuthValue
  const host = document.createElement('div')
  await act(async () => {
    createRoot(host).render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            ToastContext,
            { value: toast },
            createElement(
              MemoryRouter,
              { initialEntries: ['/chat'] },
              createElement(
                Routes,
                null,
                createElement(
                  Route,
                  { element: createElement(RequireAuth) },
                  createElement(Route, { path: 'chat', element: 'APP' }),
                ),
              ),
            ),
          ),
        ),
      ),
    )
  })
  return host.textContent ?? ''
}

test('비밀번호를 바꿔야 하는 사람에게는 앱 대신 변경 화면만 그린다', async () => {
  const text = await render(true)
  expect(text).toContain('비밀번호를 바꿔 주세요')
  expect(text).not.toContain('APP')
})

test('바꿀 필요가 없으면 앱을 그린다', async () => {
  expect(await render(false)).toBe('APP')
})
