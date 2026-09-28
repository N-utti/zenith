import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useCollabSession } from './useCollabSession'

const cache = vi.hoisted(() => ({ usable: true, opened: [] as string[] }))

vi.mock('./localCache', () => ({
  docCacheName: (docId: string) => `zenith.doc.${docId}`,
  docCacheUsable: () => cache.usable,
}))
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    constructor(name: string) {
      cache.opened.push(name)
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
    on() {}
    once() {}
    destroy() {}
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function open(docId: string) {
  let ready = false
  function Editor() {
    ready = useCollabSession(docId) !== null
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Editor)))
  act(() => root.unmount())
  return ready
}

test('앞사람 사본을 못 지운 세션은 브라우저 사본 없이 문서를 연다', async () => {
  expect(await open('a')).toBe(true)
  expect(cache.opened).toEqual(['zenith.doc.a'])

  cache.usable = false
  expect(await open('b')).toBe(true)
  expect(cache.opened).toEqual(['zenith.doc.a'])
})
