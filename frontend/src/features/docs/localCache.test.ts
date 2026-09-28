import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { claimDocCaches, releaseDocCaches } from './localCache'

const OWNER_KEY = 'zenith.docCacheOwner'
let deleted: string[]

/** 문서 사본 둘과, 지우면 안 되는 다른 저장소 하나가 있는 브라우저. */
function stubIndexedDb(
  databases = () =>
    Promise.resolve([{ name: 'zenith.doc.a' }, { name: 'zenith.doc.b' }, { name: 'zenith-files' }]),
) {
  vi.stubGlobal('indexedDB', {
    databases,
    deleteDatabase: (name: string) => deleted.push(name),
  })
}

beforeEach(() => {
  deleted = []
  localStorage.clear()
  stubIndexedDb()
})
afterEach(() => vi.unstubAllGlobals())

test('주인을 모르면 문서 사본만 지우고 로그인한 사람을 주인으로 적는다', async () => {
  await claimDocCaches('u1')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})

test('같은 사람이 다시 로그인하면 못 올린 오프라인 편집을 위해 남긴다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await claimDocCaches('u1')
  expect(deleted).toEqual([])
})

test('다른 사람이 로그인하면 지우고 주인을 바꾼다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  await claimDocCaches('u2')
  expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b'])
  expect(localStorage.getItem(OWNER_KEY)).toBe('u2')
})

test('로그아웃하면 주인을 비우고 지운다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  releaseDocCaches()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  await vi.waitFor(() => expect(deleted).toEqual(['zenith.doc.a', 'zenith.doc.b']))
})

test('목록을 못 읽으면 로그인은 막지 않고, 주인을 바꾸지 않아 다음 로그인에서 다시 지운다', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  stubIndexedDb(() => Promise.reject(new Error('blocked')))
  await expect(claimDocCaches('u2')).resolves.toBeUndefined()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})
