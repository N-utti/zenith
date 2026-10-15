import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useCollabSession } from './useCollabSession'

const cache = vi.hoisted(() => ({ usable: true, opened: [] as string[], cleared: [] as string[] }))
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
      return Promise.resolve()
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
