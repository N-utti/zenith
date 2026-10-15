import { expect, test } from 'vitest'
import { isAiCommand, linkPaths } from './aiCommand'

test('서버와 같이 /ai 커맨드를 가른다', () => {
  expect(isAiCommand('/ai 연차 규정 알려 줘')).toBe(true)
  expect(isAiCommand('  /ai  ')).toBe(true)
  expect(isAiCommand('/aim 높게')).toBe(false)
  expect(isAiCommand('/ai\n질문')).toBe(false)
  expect(isAiCommand('질문 /ai')).toBe(false)
})

test('근거 줄의 사내 경로만 링크로 감싼다', () => {
  expect(linkPaths('답\n\n근거: [1] 취업규칙 /docs/ab-12 · [2] 공지 /board/b1/p2')).toBe(
    '답\n\n근거: [1] 취업규칙 [/docs/ab-12](/docs/ab-12) · [2] 공지 [/board/b1/p2](/board/b1/p2)',
  )
  expect(linkPaths('답\n\n근거: https://x.com/docs/a')).toBe('답\n\n근거: https://x.com/docs/a')
})

test('근거 줄 밖의 경로는 건드리지 않는다', () => {
  const body = '```\n/docs/a\n```\n[문서 /docs/b](/docs/b)'
  expect(linkPaths(body)).toBe(body)
  expect(linkPaths(`${body}\n\n근거: [1] 규정 /docs/c`)).toBe(
    `${body}\n\n근거: [1] 규정 [/docs/c](/docs/c)`,
  )
})
