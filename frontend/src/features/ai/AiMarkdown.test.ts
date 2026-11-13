import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { AiMarkdown } from './AiMarkdown'

test('화면의 사내 문서 링크는 새 탭이 아니라 앱 안에서 옮긴다', () => {
  const box = document.createElement('div')
  const root = createRoot(box)
  flushSync(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AiMarkdown, {
          text: '[📄 회의록](/docs/abc) [나](/api/me) [밖](//evil.example)',
        }),
      ),
    ),
  )
  // API·바깥 주소는 라우터 안에서도 링크가 되지 않는다.
  expect(box.querySelectorAll('a')).toHaveLength(1)
  const link = box.querySelector('a')
  expect(link?.getAttribute('href')).toBe('/docs/abc')
  expect(link?.hasAttribute('target')).toBe(false)
  root.unmount()
})
