import { describe, expect, it } from 'vitest'
import { answerToSeed } from './saveAsDoc'

describe('answerToSeed', () => {
  it('각주를 빼고 마크다운을 서식으로 옮긴다', () => {
    const seed = answerToSeed('**첫** 문단[[1]]\n둘째 줄\n\n- 둘째 문단[[2]].', '노트북 지급 기준?')
    expect(seed.seedHtml).toBe(
      '<p><strong>첫</strong> 문단<br>\n둘째 줄</p>\n<ul>\n<li>둘째 문단.</li>\n</ul>',
    )
    expect(seed.title).toBe('노트북 지급 기준?')
  })

  it('CRLF 답변도 문단이 나뉜다', () => {
    expect(answerToSeed('a\r\n\r\nb', 'q').seedHtml).toBe('<p>a</p>\n<p>b</p>')
  })

  it('HTML 을 이스케이프하고 질문이 없으면 기본 제목을 쓴다', () => {
    const seed = answerToSeed('<b>a</b> & b', undefined)
    expect(seed.seedHtml).toBe('<p>&lt;b&gt;a&lt;/b&gt; &amp; b</p>')
    expect(seed.title).toBe('AI 답변')
  })

  it('제목은 한 줄로 펴고 200자에서 코드포인트 단위로 자른다', () => {
    expect(answerToSeed('x', ' a\n b ').title).toBe('a b')
    expect([...answerToSeed('x', '😀'.repeat(300)).title]).toHaveLength(200)
  })
})
