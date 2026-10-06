import { afterEach, expect, test, vi } from 'vitest'
import { uuid } from './uuid'

afterEach(() => vi.unstubAllGlobals())

// 평문 http 로 열면 `crypto.randomUUID` 가 없다. 그대로 부르면 TypeError 로 블록 댓글 시작이 죽는다.
test('randomUUID 가 없는 평문 주소에서도 v4 모양의 id 를 만든다', () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  const id = uuid()
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(uuid()).not.toBe(id)
})
