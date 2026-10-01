import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ToastContext } from '@/components/ui/ToastContext'
import { appendMessage, patchMessage, resetThread } from '@/features/ai/store'
import { AiPage } from './AiPage'

// 근거 카드는 답변 말풍선 안에 하나씩 그려진다. 이 호출 기록이 곧 다시 그려진 답변이다.
// 우측 근거 패널은 같은 카드를 또 그리므로 비워 둔다.
const drawn = vi.hoisted(() => vi.fn())
vi.mock('@/features/ai/SourcesPanel', () => ({
  SourceCard: ({ source, activeTick }: { source: { n: number }; activeTick?: number }) => {
    drawn(source.n, activeTick)
    return null
  },
  ExcludedNote: () => null,
  SourcesPanel: () => null,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 에는 없다. 대화는 그릴 때마다 맨 아래로 내린다.
Element.prototype.scrollIntoView = () => {}

let root: Root | undefined
afterEach(() => {
  // 대화는 모듈 상태다. 화면을 먼저 내려야 비울 때 살아 있는 화면이 따라 그려지지 않는다.
  act(() => root?.unmount())
  resetThread()
  drawn.mockClear()
})

const toast = { success: () => {}, error: () => {}, info: () => {} }
const source = (n: number) => ({ n, doc_id: 'd', title: '휴가 규정', quote: '인용', path: '인사' })

test('답변이 자라는 동안 지난 답변은 다시 그리지 않고, 각주는 누른 답변의 것만 켜진다', () => {
  appendMessage({ id: 'q1', role: 'user', body: '연차는 며칠인가요', createdAt: '' })
  appendMessage({
    id: 'a1',
    role: 'assistant',
    body: '15일입니다.[[1]]',
    createdAt: '',
    citations: [source(1)],
  })
  appendMessage({ id: 'q2', role: 'user', body: '반차도 되나요', createdAt: '' })
  appendMessage({
    id: 'a2',
    role: 'assistant',
    // 앞 답변과 같은 번호다. 번호만 보고 켜면 두 답변의 카드가 같이 켜진다.
    body: '[[1]]',
    createdAt: '',
    citations: [source(1)],
  })

  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(['ai', 'models'], [])
  const container = document.createElement('div')
  root = createRoot(container)
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          ToastContext,
          { value: toast },
          createElement(MemoryRouter, null, createElement(AiPage)),
        ),
      ),
    ),
  )
  /** `answer` 번째 답변(0부터)의 각주 1 을 누른다. */
  const cite = (answer: number) => {
    const button = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="근거 1 보기"]',
    )[answer]
    expect(button).toBeDefined()
    drawn.mockClear()
    act(() => button.click())
  }

  // 답변 조각 하나(`useAsk` 가 `token` 마다 하는 일). 자라는 답변의 카드만 다시 그려진다.
  drawn.mockClear()
  act(() => patchMessage('a2', (m) => ({ body: m.body + '네, ' })))
  expect(container.textContent).toContain('네, ')
  expect(drawn.mock.calls).toEqual([[1, undefined]])

  // 지난 답변의 각주를 누르면 그 답변의 카드만 켜진다(클릭 일련번호 1). 마지막 답변은 화면이
  // 돌 때마다 같이 그려진다(「다시 시도」 를 렌더마다 새로 받는다). 켜지지는 않는다.
  cite(0)
  expect(drawn.mock.calls).toEqual([
    [1, 1],
    [1, undefined],
  ])

  // 다른 답변의 각주를 누르면 앞 답변의 카드는 꺼진다.
  cite(1)
  expect(drawn.mock.calls).toEqual([
    [1, undefined],
    [1, 2],
  ])
})
