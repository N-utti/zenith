import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useCollabSession } from './useCollabSession'

const cache = vi.hoisted(() => ({
  usable: true,
  opened: [] as string[],
  cleared: [] as string[],
  /** 채우면 사본 지우기가 이 약속이 풀릴 때 끝난다. */
  gate: null as Promise<void> | null,
  /** 켜면 사본 지우기가 실패한다. */
  failClear: false,
}))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/ToastContext', () => ({ toastApi: { error: toastError } }))
const relay = vi.hoisted(() => ({ closed: [] as ((event: { code: number }) => void)[], opened: 0 }))
const invalidated = vi.hoisted(() => [] as unknown[])
const detail = vi.hoisted(() => ({ status: 'error' }))

vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: ({ queryKey }: { queryKey: unknown }) => {
      invalidated.push(queryKey)
      return Promise.resolve()
    },
    getQueryState: () => detail,
  },
}))

vi.mock('./localCache', () => ({
  docCacheName: (docId: string) => `zenith.doc.${docId}`,
  docCacheUsable: () => cache.usable,
}))
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    name: string
    constructor(name: string) {
      this.name = name
      cache.opened.push(name)
    }
    clearData() {
      cache.cleared.push(this.name)
      if (cache.failClear) return Promise.reject(new Error('blocked'))
      return cache.gate ?? Promise.resolve()
    }
    once(_event: string, callback: () => void) {
      callback()
    }
    destroy() {
      return Promise.resolve()
    }
  },
}))
// 릴레이는 붙어 있다고 치고 곧바로 끝낸다. 여기서 보는 건 브라우저 사본을 여는지뿐이다.
vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    synced = true
    constructor() {
      relay.opened++
    }
    disconnect() {}
    on(event: string, callback: (event: { code: number }) => void) {
      if (event === 'closed') relay.closed.push(callback)
    }
    connect() {}
    once() {}
    destroy() {}
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(docId: string) {
  let persistent: boolean | undefined
  function Editor() {
    persistent = useCollabSession(docId)?.persistent
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Editor)))
  return { persistent, unmount: () => act(() => root.unmount()) }
}

async function open(docId: string) {
  const { persistent, unmount } = await mount(docId)
  unmount()
  return persistent
}

test('앞사람 사본을 못 지운 세션은 브라우저 사본 없이 문서를 연다', async () => {
  expect(await open('a')).toBe(true)
  expect(cache.opened).toEqual(['zenith.doc.a'])

  // 세션이 사본 없이 열렸다는 것을 화면(오프라인 안내)이 알 수 있다.
  cache.usable = false
  expect(await open('b')).toBe(false)
  expect(cache.opened).toEqual(['zenith.doc.a'])
})

test('열람 권한이 회수돼 닫히면(4403) 브라우저 사본을 지우고 문서·트리를 다시 받는다', async () => {
  cache.usable = true
  invalidated.length = 0
  detail.status = 'error'
  const { unmount } = await mount('c')
  const opened = relay.opened
  await act(async () => relay.closed.at(-1)!({ code: 4403 }))
  expect(cache.cleared).toEqual(['zenith.doc.c'])
  expect(invalidated).toEqual([['tree'], ['documents', 'c']])
  // 다시 받은 문서가 403 이면 세션을 다시 열지 않는다(화면이 권한 없음으로 바뀐다).
  expect(relay.opened).toBe(opened)
  unmount()
})

test('4403 뒤 다시 받은 문서가 열리면 세션을 한 번만 새로 연다', async () => {
  detail.status = 'success'
  const { unmount } = await mount('d')
  const opened = relay.opened
  await act(async () => relay.closed.at(-1)!({ code: 4403 }))
  expect(relay.opened).toBe(opened + 1)
  // 새 세션도 4403 이면 더는 다시 열지 않는다(판정이 엇갈려도 되풀이하지 않게).
  await act(async () => relay.closed.at(-1)!({ code: 4403 }))
  expect(relay.opened).toBe(opened + 1)
  unmount()
})

test('잠긴 문서에 편집을 보내 닫히면(4423) 사본을 다 지운 뒤에 세션을 다시 연다', async () => {
  detail.status = 'success'
  invalidated.length = 0
  let release = () => {}
  cache.gate = new Promise((resolve) => (release = resolve))
  try {
    const { unmount } = await mount('e')
    const opened = relay.opened
    await act(async () => relay.closed.at(-1)!({ code: 4423 }))
    expect(cache.cleared).toContain('zenith.doc.e')
    expect(invalidated).toEqual([['tree'], ['documents', 'e']])
    // 친 글이 사라진 이유를 알린다.
    expect(toastError).toHaveBeenCalledWith('문서가 잠겨 있어 이 기기에서 수정한 내용은 저장되지 않았습니다.')
    // 지우기가 끝나기 전에 새 세션이 같은 사본을 열면 거절된 글을 도로 읽는다.
    expect(relay.opened).toBe(opened)
    await act(async () => release())
    expect(relay.opened).toBe(opened + 1)
    unmount()
  } finally {
    cache.gate = null
  }
})

test('4423 뒤 사본을 못 지웠으면 그 문서는 사본 없이 다시 연다(남은 사본에 거절된 글이 있다)', async () => {
  detail.status = 'success'
  cache.failClear = true
  try {
    const { unmount } = await mount('g')
    await act(async () => relay.closed.at(-1)!({ code: 4423 }))
    unmount()
    expect(cache.opened.filter((name) => name === 'zenith.doc.g')).toHaveLength(1)
    // 이 탭에서 다시 열어도 사본을 쓰지 않는다.
    expect(await open('g')).toBe(false)
  } finally {
    cache.failClear = false
  }
})
