import { expect, test } from 'vitest'
import { SOURCE_KINDS, sourceKind, sourceTo } from './source'
import type { Citation } from './types'

const base = { n: 1, title: '휴가 규정', quote: '인용', path: '인사' }

test('종류와 자리가 없는 지금 서버의 근거는 문서로 그리고 문서로 간다', () => {
  const source: Citation = { ...base, doc_id: 'd-1' }
  expect(sourceKind(source)).toBe(SOURCE_KINDS.doc)
  expect(sourceTo(source)).toBe('/docs/d-1')
})

test('서버가 자리를 주면 그리로 간다', () => {
  const source: Citation = { ...base, type: 'post', to: '/board/all/p-1' }
  expect(sourceKind(source)).toBe(SOURCE_KINDS.post)
  expect(sourceTo(source)).toBe('/board/all/p-1')
})

test('앱 밖을 가리키는 자리는 따르지 않는다', () => {
  const outside = [
    'https://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    // 브라우저가 `//evil.example` 로 읽는 값들
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
  ]
  for (const to of outside) {
    expect(sourceTo({ ...base, doc_id: 'd-1', to })).toBe('/docs/d-1')
    expect(sourceTo({ ...base, to })).toBeNull()
  }
})

test('모르는 종류는 문서로 그린다', () => {
  for (const type of ['chat', 'constructor']) {
    expect(sourceKind({ ...base, type } as unknown as Citation)).toBe(SOURCE_KINDS.doc)
  }
})
