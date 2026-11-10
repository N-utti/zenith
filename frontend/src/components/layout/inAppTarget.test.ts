import { expect, test } from 'vitest'
import { inAppTarget } from './desktopTabs'

// Ctrl+클릭·휠 클릭을 앱 안 탭으로 열 링크인지. 파일·바깥 주소·같은 화면 안 이동은 탭이 아니다.
test.each([
  ['<a href="/docs/d-1">문서</a>', '/docs/d-1'],
  ['<a href="/chat/c1?m=9">메시지</a>', '/chat/c1?m=9'],
  ['<a href="/api/files/abc">첨부</a>', null],
  ['<a href="/docs/d-1" download>받기</a>', null],
  ['<a href="https://example.com/x">바깥</a>', null],
  ['<a href="mailto:a@b.c">메일</a>', null],
  [`<a href="${location.pathname}#fn-1">각주</a>`, null],
])('%s → %s', (html, expected) => {
  const box = document.createElement('div')
  box.innerHTML = html
  expect(inAppTarget(box.querySelector('a'))).toBe(expected)
})
