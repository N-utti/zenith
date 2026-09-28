import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** 사본 사용 여부는 모듈 상태다. 테스트마다 새로 불러와 앞 테스트의 값이 새지 않게 한다. */
let cache: typeof import('./localCache')

const OWNER_KEY = 'zenith.docCacheOwner'
let deleted: string[]

/** 문서 사본 둘과, 지우면 안 되는 목업 파일 저장소(접두어 `zenith.` 까지 같다)가 있는 브라우저. */
function stubIndexedDb(
  databases: (() => Promise<{ name: string }[]>) | undefined = () =>
    Promise.resolve([{ name: 'zenith.doc.a' }, { name: 'zenith.doc.b' }, { name: 'zenith.files' }]),
) {
  vi.stubGlobal('indexedDB', { databases, deleteDatabase: (name: string) => deleted.push(name) })
}

beforeEach(async () => {
  vi.resetModules()
  cache = await import('./localCache')
  deleted = []
  localStorage.clear()
  stubIndexedDb()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('주인을 모르면 문서 사본만 지우고 인증된 사람을 주인으로 적는다', async () => {
  await cache.claimDocCaches('u1')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
  expect(cache.docCacheUsable()).toBe(true)
})

test('같은 사람이면 못 올린 오프라인 편집을 위해 남긴다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await cache.claimDocCaches('u1')
  expect(deleted).toEqual([])
})

test('다른 사람이면 지우고 주인을 바꾼다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await cache.claimDocCaches('u2')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u2')
})

test('지워야 하는데 목록을 못 읽으면 주인을 그대로 두고 이번 세션은 사본을 쓰지 않는다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  stubIndexedDb(() => Promise.reject(new Error('blocked')))
  await expect(cache.claimDocCaches('u2')).resolves.toBeUndefined()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
  expect(cache.docCacheUsable()).toBe(false)
})

test('목록 기능이 없는 브라우저도 사본을 쓰지 않는다', async () => {
  vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => deleted.push(name) })
  await cache.claimDocCaches('u2')
  expect(cache.docCacheUsable()).toBe(false)
  // 다시 지울 수 있게 되면 되살아난다.
  stubIndexedDb()
  await cache.claimDocCaches('u2')
  expect(cache.docCacheUsable()).toBe(true)
})

test('누구인지 모르면 지우고 주인도 비운다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await cache.disownDocCaches()
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('목록이 끝내 안 오면 앱을 붙잡지 않고 사본 없이 간다', async () => {
  vi.useFakeTimers()
  stubIndexedDb(() => new Promise(() => {}))
  const claimed = cache.claimDocCaches('u2')
  await vi.advanceTimersByTimeAsync(2000)
  await expect(claimed).resolves.toBeUndefined()
  expect(cache.docCacheUsable()).toBe(false)
})

test('주인과 같은 사람이 들어오면 앞 세션에서 꺼 둔 사본을 되살린다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  stubIndexedDb(() => Promise.reject(new Error('blocked')))
  await cache.claimDocCaches('u2') // 못 지워 꺼짐, 주인은 u1 그대로
  expect(cache.docCacheUsable()).toBe(false)
  await cache.claimDocCaches('u1')
  expect(cache.docCacheUsable()).toBe(true)
})

test('목록 조회가 곧바로 던져도 타이머가 떠돌지 않는다', async () => {
  vi.useFakeTimers()
  stubIndexedDb(() => {
    throw new Error('sync')
  })
  await cache.claimDocCaches('u2')
  expect(cache.docCacheUsable()).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

test('주인을 못 적으면 이번 세션은 사본을 쓰지 않는다', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota')
  })
  await cache.claimDocCaches('u2')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(cache.docCacheUsable()).toBe(false)
})
