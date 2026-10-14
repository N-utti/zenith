import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AiMarkdown } from './AiMarkdown'

/**
 * AI 마크다운을 편집기에 넣을 HTML 로 바꾼다. 화면과 같은 `AiMarkdown` 을 화면 밖 상자에 그려
 * 그 HTML 을 읽는다. 그래서 막는 것(raw HTML·위험한 링크·바깥 그림)도 화면과 같다.
 *
 * 글자 이스케이프는 `escapeHtml` 대신 DOM 직렬화(`innerHTML`)가 한다. 텍스트의 `<`·`&` 는
 * 엔티티로 나온다. `renderToStaticMarkup` 을 쓰지 않는 건 서버 렌더러(수백 KB)가 번들에 딸려
 * 오기 때문이다.
 *
 * `flushSync` 를 쓰므로 렌더 중이 아니라 이벤트 처리 안에서 부른다.
 */
export function markdownToHtml(text: string): string {
  const box = document.createElement('div')
  const root = createRoot(box)
  flushSync(() => root.render(createElement(AiMarkdown, { text })))
  const html = box.innerHTML
  root.unmount()
  // 렌더 중에 부르면 React 가 flushSync 를 미뤄 빈 HTML 이 나온다. 빈 문서를 조용히 만들지 않는다.
  if (!html && text.trim()) throw new Error('markdownToHtml: 이벤트 처리 안에서 불러야 한다')
  return html
}
