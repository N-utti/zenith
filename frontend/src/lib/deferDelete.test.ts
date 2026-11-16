import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ToastApi, ToastOptions } from '@/components/ui/ToastContext'
import { deferDelete, useWithoutPending } from './deferDelete'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() } satisfies ToastApi
/** 방금 뜬 되돌리기 토스트의 옵션. 닫힘(`onClose`)과 되돌리기(`action`)를 여기서 누른다. */
const last = () => toast.success.mock.lastCall![1] as ToastOptions

/** 목록 훅처럼 걸러서 남은 id 를 글자로 그린다. 모듈 상태가 테스트 사이에 남으니 테스트마다 다른 id 를 쓴다. */
function show(ids: string[]) {
  function List() {
    const select = useWithoutPending<{ id: string }>()
    return createElement(
      'output',
      null,
      select({ items: ids.map((id) => ({ id })) })
        .items.map((i) => i.id)
        .join(','),
    )
  }
  const container = document.createElement('div')
  act(() => createRoot(container).render(createElement(List)))
  return () => container.textContent
}
const run = (ids: string[], commit: () => Promise<string[] | void>) =>
  act(() => deferDelete(toast, { ids, message: '지웠습니다.', commit, failMessage: '실패' }))

beforeEach(() => vi.clearAllMocks())

test('화면에서는 바로 빼고, 토스트가 되돌리기 없이 닫혀야 실제로 지운다', async () => {
  const shown = show(['a1', 'a2'])
  const commit = vi.fn(() => Promise.resolve())
  run(['a1'], commit)

  expect(shown()).toBe('a2')
  // 토스트에 마우스를 올려 두는 동안은 닫히지 않는다. 그동안은 아무것도 보내지 않는다.
  expect(commit).not.toHaveBeenCalled()
  await act(async () => last().onClose!())
  expect(commit).toHaveBeenCalledOnce()
  expect(shown()).toBe('a2')
})

test('되돌리면 보내지 않고 다시 보인다', () => {
  const shown = show(['b1'])
  const commit = vi.fn(() => Promise.resolve())
  run(['b1'], commit)
  act(() => last().action!.onClick())
  act(() => last().onClose?.())

  expect(commit).not.toHaveBeenCalled()
  expect(shown()).toBe('b1')
})

test('보낸 지우기가 실패하면 다시 보이고 이유를 띄운다', async () => {
  const shown = show(['c1'])
  run(['c1'], () => Promise.reject(new Error('x')))
  await act(async () => last().onClose!())

  expect(shown()).toBe('c1')
  expect(toast.error).toHaveBeenCalledWith('실패')
})

test('일부만 지웠으면 지우지 못한 것만 다시 보인다(휴지통 비우기)', async () => {
  const shown = show(['d1', 'd2', 'd3'])
  run(['d1', 'd2', 'd3'], () => Promise.resolve(['d2']))
  await act(async () => last().onClose!())

  expect(shown()).toBe('d2')
})

test('이미 지우기를 기다리는 것은 또 받지 않는다', () => {
  run(['e1'], () => Promise.resolve())
  const second = vi.fn(() => Promise.resolve())
  run(['e1'], second)

  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.info).toHaveBeenCalledWith('이미 지우는 중입니다.')
})
