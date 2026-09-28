import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { claimDocCaches, docCacheUsable, disownDocCaches } from './localCache'

const OWNER_KEY = 'zenith.docCacheOwner'
let deleted: string[]

/** 문서 사본 둘과, 지우면 안 되는 목업 파일 저장소(접두어 `zenith.` 까지 같다)가 있는 브라우저. */
function stubIndexedDb(
  databases: (() => Promise<{ name: string }[]>) | undefined = () =>
    Promise.resolve([{ name: 'zenith.doc.a' }, { name: 'zenith.doc.b' }, { name: 'zenith.files' }]),
) {
  vi.stubGlobal('indexedDB', { databases, deleteDatabase: (name: string) => deleted.push(name) })
}

beforeEach(() => {
  deleted = []
  localStorage.clear()
  stubIndexedDb()
})
afterEach(() => vi.unstubAllGlobals())

test('주인을 모르면 문서 사본만 지우고 인증된 사람을 주인으로 적는다', async () => {
  await claimDocCaches('u1')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
  expect(docCacheUsable()).toBe(true)
})

test('같은 사람이면 못 올린 오프라인 편집을 위해 남긴다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await claimDocCaches('u1')
  expect(deleted).toEqual([])
})

test('다른 사람이면 지우고 주인을 바꾼다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await claimDocCaches('u2')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u2')
})

test('지워야 하는데 목록을 못 읽으면 주인을 그대로 두고 이번 세션은 사본을 쓰지 않는다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  stubIndexedDb(() => Promise.reject(new Error('blocked')))
  await expect(claimDocCaches('u2')).resolves.toBeUndefined()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
  expect(docCacheUsable()).toBe(false)
})

test('목록 기능이 없는 브라우저도 사본을 쓰지 않는다', async () => {
  vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => deleted.push(name) })
  await claimDocCaches('u2')
  expect(docCacheUsable()).toBe(false)
  // 다시 지울 수 있게 되면 되살아난다.
  stubIndexedDb()
  await claimDocCaches('u2')
  expect(docCacheUsable()).toBe(true)
})

test('누구인지 모르면 지우고 주인도 비운다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await disownDocCaches()
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('목록이 끝내 안 오면 앱을 붙잡지 않고 사본 없이 간다', async () => {
  vi.useFakeTimers()
  stubIndexedDb(() => new Promise(() => {}))
  const claimed = claimDocCaches('u2')
  await vi.advanceTimersByTimeAsync(2000)
  await expect(claimed).resolves.toBeUndefined()
  expect(docCacheUsable()).toBe(false)
  vi.useRealTimers()
})
