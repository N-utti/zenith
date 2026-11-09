import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ToastContext, type ToastApi } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { docKeys } from '@/features/docs/api'
import type { DocTreeData } from '@/features/docs/types'
import { DocTree } from './DocTree'

const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const auth = {
  user: { id: 'me', name: '나', role: 'member' },
  status: 'authenticated',
} as unknown as AuthValue
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() } satisfies ToastApi
const tree = {
  folders: [
    { id: 'f-1', parent_id: null, title: '기획', sort: 0, min_role: 'member', allowed_users: [] },
  ],
  docs: [],
} as unknown as DocTreeData

let root: Root | undefined
beforeEach(() => vi.clearAllMocks())
afterEach(() => act(() => root?.unmount()))

/** 지금 주소와 넘긴 state 를 찍어 둔다. 새 문서로 넘어갔는지 여기서 읽는다. */
function Probe() {
  const { pathname, state } = useLocation()
  return createElement('output', { 'data-path': pathname, 'data-state': JSON.stringify(state) })
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })

/** `qc` 를 넘기면 그 캐시로 다시 그린다(편집기를 드나들 때 트리가 새로 마운트되는 것). */
function render(qc = newClient()) {
  qc.setQueryData(docKeys.tree, tree)
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
            ToastContext,
            { value: toast },
            createElement(
              MemoryRouter,
              { initialEntries: ['/'] },
              createElement(DocTree),
              createElement(Probe),
            ),
          ),
        ),
      ),
    ),
  )
  return container
}

/** 바탕화면에서 파일을 끌어 와 놓는다. jsdom 에 DataTransfer 가 없어 필요한 칸만 붙인다. */
function dropFiles(target: Element, files: File[]) {
  for (const type of ['dragover', 'drop']) {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'dataTransfer', {
      value: { types: ['Files'], files, dropEffect: 'none' },
    })
    target.dispatchEvent(e)
  }
}

const folderRow = (c: HTMLElement) => c.querySelector('[data-drop="f-1"]')!

test('폴더에 파일을 놓으면 그 폴더로 가져와, 받은 본문을 들고 새 문서를 연다', async () => {
  // 가져온 뒤 트리를 다시 받는다. 그 요청에는 트리를 돌려준다.
  api.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/docs/import'
        ? { doc: { id: 'd-new', title: '기획서' }, html: '<p>본문</p>', truncated: true, file: {} }
        : tree,
    ),
  )
  const container = render()
  const file = new File(['x'], '기획서.docx')

  await act(async () => dropFiles(folderRow(container), [file]))

  const [path, init] = api.mock.calls.find(([p]) => p === '/docs/import') as [
    string,
    { body: FormData },
  ]
  expect(path).toBe('/docs/import')
  expect(init.body.get('file')).toBe(file)
  expect(init.body.get('folder_id')).toBe('f-1')
  const probe = container.querySelector('output')!
  expect(probe.dataset.path).toBe('/docs/d-new')
  expect(JSON.parse(probe.dataset.state!)).toEqual({ seedHtml: '<p>본문</p>', title: '기획서' })
  expect(toast.info).toHaveBeenCalledOnce()
})

test('여러 파일을 한꺼번에 놓으면 가져오지 않는다(본문을 심을 탭이 하나뿐이다)', async () => {
  const container = render()
  await act(async () =>
    dropFiles(folderRow(container), [new File(['a'], 'a.docx'), new File(['b'], 'b.xlsx')]),
  )
  expect(api).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledOnce()
})

test('가져오는 도중 트리가 새로 마운트돼도 진행 표시와 중복 막기가 남는다', async () => {
  api.mockImplementation((path: string) =>
    path === '/docs/import' ? new Promise(() => {}) : Promise.resolve(tree),
  )
  const qc = newClient()
  const first = render(qc)
  await act(async () => dropFiles(folderRow(first), [new File(['a'], 'a.docx')]))
  act(() => root!.unmount())

  const second = render(qc)
  expect(second.querySelector('[aria-label="파일 가져오는 중"]')).not.toBeNull()
  await act(async () => dropFiles(folderRow(second), [new File(['b'], 'b.docx')]))
  expect(api.mock.calls.filter(([p]) => p === '/docs/import')).toHaveLength(1)
  expect(toast.info).toHaveBeenCalledOnce()
})

test('docx·xlsx·hwpx 가 아니면 올리지 않고 바로 알린다', async () => {
  const container = render()
  await act(async () => dropFiles(folderRow(container), [new File(['a'], '사진.png')]))
  expect(api).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledOnce()
})
