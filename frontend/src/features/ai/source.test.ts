import { expect, test } from 'vitest'
import { SOURCE_KINDS, sourceKind, sourceTo, webLink } from './source'
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

test('웹 출처는 앱 안으로 보내지 않고 바깥 주소와 그 호스트를 준다', () => {
  const source: Citation = {
    ...base,
    type: 'web',
    to: 'https://www.korea.kr/news/1',
    path: '사내.example',
  }
  expect(sourceKind(source)).toBe(SOURCE_KINDS.web)
  expect(sourceTo(source)).toBeNull()
  // 카드에 보이는 호스트는 서버 글(path)이 아니라 실제 갈 주소에서 뽑는다.
  expect(webLink(source)).toEqual({ href: 'https://www.korea.kr/news/1', host: 'www.korea.kr' })
})

test('웹 출처라도 http·https 가 아니거나 사용자 정보로 위장한 주소는 링크로 만들지 않는다', () => {
  for (const to of [
    'javascript:alert(1)',
    'data:text/html,x',
    '/docs/d-1',
    'https://intranet.local@evil.example/',
    '주소 아님',
  ]) {
    expect(webLink({ ...base, type: 'web', to })).toBeNull()
  }
  expect(webLink({ ...base, type: 'doc', to: 'https://www.korea.kr/' })).toBeNull()
})
