import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { answerConfirm } from '@/components/ui/confirm'
import { ToastContext, type ToastApi, type ToastOptions } from '@/components/ui/ToastContext'
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
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() } satisfies ToastApi
/** 방금 뜬 삭제 토스트의 옵션. 닫힘(`onClose`)과 실행 취소(`action`)를 여기서 누른다. */
const lastToast = () => toast.success.mock.lastCall![1] as ToastOptions
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
/** 내 임시저장. 삭제를 기다리는 id 는 모듈 상태라 테스트마다 다른 id 를 쓴다. */
const draftOf = (id: string) => ({
  ...doc,
  id,
  drafter: { id: 'me', name: '나' },
  title: '출장비 초안',
  status: 'draft',
  submitted_at: null,
  closed_at: null,
})

let root: Root | undefined
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

/** 동료 명단(`/people`). 결재 응답의 기안자는 이름뿐이라 상세가 등급·팀을 여기서 붙인다. */
let people: {
  id: string
  name: string
  active: boolean
  role: string
  team: { id: string; name: string } | null
}[] = [
  { id: 'u-2', name: '이지원', active: true, role: 'member', team: { id: 't-1', name: '개발팀' } },
]

/** 목록 요청(`/approvals?box=...`)에는 그 문서 하나, 문서 요청(`/approvals/:id`)에는 그 문서. */
function render(at: string, item: object = doc) {
  api.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/people'
        ? { items: people }
        : path.startsWith('/approvals?')
          ? { items: [item], next_cursor: null }
          : item,
    ),
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
              { initialEntries: [at] },
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
  return container
}

test('전체 문서에서 연 문서의 결재함 링크는 고른 필터째 전체 문서로 돌아온다', async () => {
  const container = render('/approvals?box=done&status=approved')
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

test('상세 머리에 유형·기안자·기안일을 라벨과 함께 보이고, 기안자에 등급·팀을 붙인다', async () => {
  const container = render('/approvals/a-1')
  const meta = () => container.querySelector('header dl')?.textContent
  await vi.waitFor(() => expect(meta()).toContain('기안자이지원 / 사원 / 개발팀'))
  expect(meta()).toContain('유형일반 기안')
  expect(meta()).toContain('기안일')
})

test('기안자를 명단에서 못 찾으면 이름만, 팀장 등급은 사원으로 보인다', async () => {
  const saved = people
  people = [{ ...saved[0], role: 'lead', team: null }]
  try {
    const container = render('/approvals/a-1')
    const drafter = () => container.querySelectorAll('header dd')[1]?.textContent
    await vi.waitFor(() => expect(drafter()).toBe('이지원 / 사원'))

    people = []
    act(() => root?.unmount())
    const again = render('/approvals/a-1')
    await vi.waitFor(() =>
      expect(again.querySelectorAll('header dd')[1]?.textContent).toBe('이지원'),
    )
  } finally {
    people = saved
  }
})

/** 임시저장 탭에서 그 줄의 삭제 버튼을 누르고 확인 창에서 삭제를 고른다. */
async function deleteDraft(id: string) {
  const container = render('/approvals?box=draft', draftOf(id))
  const row = () => container.querySelector(`tr[data-id="${id}"]`)
  await vi.waitFor(() => expect(row()).not.toBeNull())
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="출장비 초안 임시저장 삭제"]')!
      .click(),
  )
  await act(async () => answerConfirm(true))
  return row
}
const deletes = () => api.mock.calls.filter(([, init]) => init?.method === 'DELETE')

test('삭제하면 목록에서 바로 빠지고, 실행 취소를 누르면 보내지 않고 다시 보인다', async () => {
  const row = await deleteDraft('d-undo')

  expect(row()).toBeNull()
  expect(toast.success).toHaveBeenCalledWith(
    '임시저장을 삭제했습니다.',
    expect.objectContaining({ action: expect.objectContaining({ label: '실행 취소' }) }),
  )
  act(() => lastToast().action!.onClick())
  expect(row()).not.toBeNull()
  // 실행 취소로 토스트가 닫혀도 보내지 않는다.
  await act(async () => lastToast().onClose?.())
  expect(deletes()).toEqual([])
})

test('실행 취소 없이 토스트가 닫히면 그때 삭제를 보낸다', async () => {
  const row = await deleteDraft('d-gone')

  expect(row()).toBeNull()
  expect(deletes()).toEqual([])
  await act(async () => lastToast().onClose!())
  await vi.waitFor(() =>
    expect(deletes()).toEqual([['/approvals/drafts/d-gone', { method: 'DELETE' }]]),
  )
})

test('상세에서 삭제하면 바로 전체 문서로 옮기고, 화면을 떠난 뒤 토스트가 닫힐 때 삭제를 보낸다', async () => {
  const container = render('/approvals/a-leave', { ...doc, id: 'a-leave' })
  const button = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === '삭제')
  await vi.waitFor(() => expect(button()).toBeDefined())
  act(() => button()!.click())
  await act(async () => answerConfirm(true))

  // 서버 응답을 기다리지 않고 옮긴다. 서버에는 아직 있는 문서지만 목록에서는 빠져 있다.
  await vi.waitFor(() => expect(container.textContent).toContain('문서가 없습니다.'))
  expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain(
    '전체 문서',
  )
  expect(deletes()).toEqual([])

  // 삭제를 건 상세 화면은 이미 내려갔다. 그래도 요청은 나간다.
  await act(async () => lastToast().onClose!())
  await vi.waitFor(() => expect(deletes()).toEqual([['/approvals/a-leave', { method: 'DELETE' }]]))
})
