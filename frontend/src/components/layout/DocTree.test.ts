import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '@/lib/api'
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

/** 가져오기 요청마다 파일 이름을 제목으로 한 문서를 돌려준다. 그 밖의 요청(트리 다시 받기)에는 트리. */
function serveImports(fail: Record<string, string> = {}) {
  let n = 0
  api.mockImplementation((path: string, init?: { body: FormData }) => {
    if (path !== '/docs/import') return Promise.resolve(tree)
    const name = (init!.body.get('file') as File).name
    if (fail[name]) return Promise.reject(new ApiError(422, fail[name]))
    const title = name.replace(/\.[^.]+$/, '')
    return Promise.resolve({
      doc: { id: `d-${++n}`, title },
      truncated: title === '긴 표',
      file: {},
    })
  })
}
const imports = () =>
  api.mock.calls.filter(([p]) => p === '/docs/import') as [string, { body: FormData }][]
const probe = (c: HTMLElement) => c.querySelector('output')!.dataset

test('폴더에 파일 하나를 놓으면 그 폴더로 가져와 새 문서를 연다(본문은 서버가 심었다)', async () => {
  serveImports()
  const container = render()
  const file = new File(['x'], '긴 표.docx')

  await act(async () => dropFiles(folderRow(container), [file]))

  const [[, init]] = imports()
  expect(init.body.get('file')).toBe(file)
  expect(init.body.get('folder_id')).toBe('f-1')
  expect(probe(container).path).toBe('/docs/d-1')
  // 본문은 서버가 심었으니 초안을 넘기지 않는다(README 61).
  expect(probe(container).state).toBe('null')
  expect(toast.info).toHaveBeenCalledOnce()
})

test('여러 파일은 하나씩 차례로 가져오고, 보던 화면에 남아 결과만 알린다', async () => {
  serveImports({ 'b.xlsx': '빈 파일입니다.' })
  const container = render()
  await act(async () =>
    dropFiles(folderRow(container), [
      new File(['a'], 'a.docx'),
      new File(['b'], 'b.xlsx'),
      new File(['c'], 'c.png'),
      new File(['d'], 'd.hwpx'),
    ]),
  )

  // 형식이 아닌 png 는 보내지 않고, 나머지는 놓은 순서대로.
  expect(imports().map(([, i]) => (i.body.get('file') as File).name)).toEqual([
    'a.docx',
    'b.xlsx',
    'd.hwpx',
  ])
  expect(probe(container).path).toBe('/')
  // 성공 수와 실패 목록을 한 토스트에(따로 띄우면 성공이 실패 뒤에 접힌다).
  expect(toast.success).not.toHaveBeenCalled()
  const [message] = toast.error.mock.calls[0] as [string]
  expect(message).toMatch(/^2개를 가져왔습니다\. /)
  expect(message).toContain('b.xlsx(빈 파일입니다.)')
  expect(message).toContain('c.png')
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

test('여러 파일은 앞 파일이 끝나야 다음을 보내고, 폴더 줄에 몇 번째인지 보인다', async () => {
  // 서버 동시 변환 칸이 둘이라 한꺼번에 보내면 429. 요청을 손으로 하나씩 풀어 순서를 본다.
  const pending: (() => void)[] = []
  api.mockImplementation((path: string) =>
    path === '/docs/import'
      ? new Promise((resolve) =>
          pending.push(() => resolve({ doc: { id: 'd', title: 't' }, truncated: false, file: {} })),
        )
      : Promise.resolve(tree),
  )
  const container = render()
  const progress = () => container.querySelector('[aria-label="파일 가져오는 중"]')?.textContent
  await act(async () =>
    dropFiles(folderRow(container), [new File(['a'], 'a.docx'), new File(['b'], 'b.docx')]),
  )
  expect(imports()).toHaveLength(1)
  expect(progress()).toBe('1/2')

  // 진행 표시는 캐시 알림이 다음 박자(setTimeout 0)에 다시 그린다. 전체 테스트를 같이 돌리면 한 박자로는
  // 모자랄 때가 있어 그려질 때까지 박자를 넘긴다.
  await act(async () => pending[0]!())
  await vi.waitFor(async () => {
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(progress()).toBe('2/2')
  })
  expect(imports()).toHaveLength(2)
})

test('하루 상한(429)처럼 파일과 상관없는 거절이면 남은 파일은 보내지 않는다', async () => {
  api.mockImplementation((path: string) =>
    path === '/docs/import'
      ? Promise.reject(new ApiError(429, '오늘 올릴 수 있는 파일 수를 넘었습니다.'))
      : Promise.resolve(tree),
  )
  const container = render()
  await act(async () =>
    dropFiles(folderRow(container), [
      new File(['a'], 'a.docx'),
      new File(['b'], 'b.docx'),
      new File(['c'], 'c.docx'),
    ]),
  )
  expect(imports()).toHaveLength(1)
  expect(toast.error.mock.calls[0]![0]).toContain('나머지 2개(보내지 않음)')
})
