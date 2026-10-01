import { expect, it } from 'vitest'
import { docIdOf, internalPath, splitLinks } from './links'

it('평문 속 주소만 링크 조각이 되고, 이어 붙이면 원문 그대로다', () => {
  const text = '회의록 https://zenith.co.kr/docs/d-1 확인 부탁'
  const parts = splitLinks(text)
  expect(parts).toEqual([
    { text: '회의록 ' },
    { text: 'https://zenith.co.kr/docs/d-1', href: 'https://zenith.co.kr/docs/d-1' },
    { text: ' 확인 부탁' },
  ])
  expect(parts.map((p) => p.text).join('')).toBe(text)
  expect(splitLinks('주소 없음')).toEqual([{ text: '주소 없음' }])
})

it('문장 부호와 붙여 쓴 한글 조사는 주소에 넣지 않는다', () => {
  const href = (text: string) => splitLinks(text).find((p) => p.href)?.href
  expect(href('(https://a.com/x).')).toBe('https://a.com/x')
  expect(href('https://a.com/x를 봐 주세요')).toBe('https://a.com/x')
  expect(href('https://a.com/x?m=1#top, 그리고')).toBe('https://a.com/x?m=1#top')
})

it('http·https 가 아니면 링크가 아니다', () => {
  // 본문은 믿을 수 없는 입력이다. 스킴 허용 목록이 XSS 방어다.
  for (const text of ['javascript:alert(1)', 'data:text/html,<script>', 'https://', 'a@b.com']) {
    expect(splitLinks(text).some((p) => p.href)).toBe(false)
  }
})

it('제니스 안 주소는 앱 경로로, 바깥과 /api 는 null', () => {
  const origins = ['tauri://localhost', 'https://zenith.co.kr']
  expect(internalPath('https://zenith.co.kr/chat/c-1?m=m-9', origins)).toBe('/chat/c-1?m=m-9')
  expect(internalPath('https://example.com/docs/d-1', origins)).toBeNull()
  // 호스트 앞부분만 같은 주소에 속지 않는다.
  expect(internalPath('https://zenith.co.kr.evil.com/docs/d-1', origins)).toBeNull()
  expect(internalPath('https://zenith.co.kr/api/files/f-1', origins)).toBeNull()
  expect(internalPath('https://zenith.co.kr/api', origins)).toBeNull()
})

it('경로가 // 로 시작하면 안쪽으로 치지 않는다. 라우터가 다른 호스트로 읽는다', () => {
  const origins = ['https://zenith.co.kr']
  for (const href of [
    'https://zenith.co.kr//evil.com/login',
    'https://zenith.co.kr/\\evil.com/login',
    'https://zenith.co.kr/x/..//evil.com',
    'https://zenith.co.kr\\\\evil.com',
  ]) {
    expect(internalPath(href, origins)).toBeNull()
  }
})

it('짝이 있는 닫는 괄호는 주소에 남긴다', () => {
  const href = (text: string) => splitLinks(text).find((p) => p.href)?.href
  expect(href('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  )
  expect(href('(https://en.wikipedia.org/wiki/Foo_(bar)).')).toBe(
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  )
})

it('폭 없는 공백과 방향 제어 문자에서 주소를 끊는다', () => {
  const href = (text: string) => splitLinks(text).find((p) => p.href)?.href
  expect(href('https://zenith.co.kr\u200B.evil.com')).toBe('https://zenith.co.kr')
  expect(href('https://evil.com/\u202Erk.oc.htinez')).toBe('https://evil.com/')
})

it('부호가 길게 이어져도 금방 끝난다', () => {
  const started = performance.now()
  splitLinks('https://a' + ')'.repeat(50_000) + 'x')
  expect(performance.now() - started).toBeLessThan(500)
})

it('문서 하나를 가리키는 경로에서만 문서 id 를 꺼낸다', () => {
  expect(docIdOf('/docs/d-1')).toBe('d-1')
  // 댓글로 가는 주소도 같은 문서다.
  expect(docIdOf('/docs/d-1?comment=dc-1')).toBe('d-1')
  expect(docIdOf('/docs/d-1#h')).toBe('d-1')
  // 뒤에 경로가 더 붙으면 문서 화면이 아니다. 칩을 달면 죽은 링크에 제목이 붙는다.
  expect(docIdOf('/docs/d-1/extra')).toBeNull()
  expect(docIdOf('/docs')).toBeNull()
  expect(docIdOf('/docs/trash')).toBeNull()
  expect(docIdOf('/chat/c-1')).toBeNull()
})
