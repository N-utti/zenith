import { expect, it } from 'vitest'
import { parseSnippet } from './snippet'

it('일치 부분만 강조로 나눈다', () => {
  expect(parseSnippet('앞 **로드맵** 뒤')).toEqual([
    { text: '앞 ', hit: false },
    { text: '로드맵', hit: true },
    { text: ' 뒤', hit: false },
  ])
  expect(parseSnippet('**처음**과 **끝**')).toEqual([
    { text: '처음', hit: true },
    { text: '과 ', hit: false },
    { text: '끝', hit: true },
  ])
})

it('짝이 맞지 않는 마커는 글자 그대로 남긴다', () => {
  // 스니펫은 본문을 자른 것이라 마커가 반쪽만 들어올 수 있다.
  expect(parseSnippet('앞 **로드맵')).toEqual([{ text: '앞 **로드맵', hit: false }])
  expect(parseSnippet('')).toEqual([])
  expect(parseSnippet('강조 없음')).toEqual([{ text: '강조 없음', hit: false }])
})

it('태그가 들어와도 글자일 뿐이다. HTML 로 그리지 않는다', () => {
  // 서버가 이스케이프해 보내지만, 설령 날것이 와도 조각의 text 로만 남아야 한다.
  expect(parseSnippet('<svg onload=alert(1)> **히트**')).toEqual([
    { text: '<svg onload=alert(1)> ', hit: false },
    { text: '히트', hit: true },
  ])
})
