import { describe, expect, it } from 'vitest'
import { answerToSeed } from './saveAsDoc'

describe('answerToSeed', () => {
  it('각주를 빼고 빈 줄로 문단을 나눈다', () => {
    const seed = answerToSeed('첫 문단[[1]]\n둘째 줄\n\n둘째 문단[[2]].', '노트북 지급 기준?')
    expect(seed.seedHtml).toBe('<p>첫 문단<br>둘째 줄</p><p>둘째 문단.</p>')
    expect(seed.title).toBe('노트북 지급 기준?')
  })

  it('CRLF 답변도 문단이 나뉜다', () => {
    expect(answerToSeed('a\r\n\r\nb', 'q').seedHtml).toBe('<p>a</p><p>b</p>')
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
