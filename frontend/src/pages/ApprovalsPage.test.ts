import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ToastContext } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { ApprovalDetailPage } from './ApprovalDetailPage'
import { ApprovalsPage } from './ApprovalsPage'

const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 에는 없다. 표가 옆으로 넘치는지 지켜보는 데 쓴다(`Table`).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

// 전체 문서 탭은 임원에게만 있다.
const auth = {
  user: { id: 'me', name: '나', role: 'exec' },
  status: 'authenticated',
} as unknown as AuthValue
const toast = { success: () => {}, error: () => {}, info: () => {} }
const doc = {
  id: 'a-1',
  type_code: 'general',
  drafter: { id: 'u-2', name: '이지원' },
  title: '워크숍 장소 대관',
  status: 'approved',
  current_step: null,
  waiting_on: null,
  submitted_at: '2026-11-18T01:00:00Z',
  created_at: '2026-11-18T00:00:00Z',
  amount: null,
  related: null,
  subject: { body: '본문', amount: null, related: null },
  steps: [],
  closed_at: '2026-11-19T00:00:00Z',
  can_decide: false,
}

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

test('전체 문서에서 연 문서의 결재함 링크는 고른 필터째 전체 문서로 돌아온다', async () => {
  // 목록 요청(`/approvals?box=...`)에는 문서 하나, 문서 요청(`/approvals/a-1`)에는 그 문서.
  api.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/approvals?') ? { items: [doc], next_cursor: null } : doc),
  )
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            ToastContext,
            { value: toast },
            createElement(
              MemoryRouter,
              { initialEntries: ['/approvals?box=done&status=approved'] },
              createElement(
                Routes,
                null,
                createElement(Route, { path: '/approvals', element: createElement(ApprovalsPage) }),
                createElement(Route, {
                  path: '/approvals/:approvalId',
                  element: createElement(ApprovalDetailPage),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  const link = (text: string) =>
    [...container.querySelectorAll('a')].find((a) => a.textContent === text)

  await vi.waitFor(() => expect(link('워크숍 장소 대관')).toBeDefined())
  act(() => link('워크숍 장소 대관')!.click())
  await vi.waitFor(() => expect(link('결재함')).toBeDefined())
  expect(link('결재함')!.getAttribute('href')).toBe('/approvals?box=done&status=approved')

  act(() => link('결재함')!.click())
  await vi.waitFor(() =>
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain(
      '전체 문서',
    ),
  )
})
