import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { docContentExtensions } from './editorExtensions'
import { changedSentences, citedSentences, replaceSentence } from './groundedDraft'

const original =
  '연차 휴가 안내\n\n수습 기간은 3개월입니다. 연차는 2년까지 이월됩니다. 점심은 12시입니다.'

describe('citedSentences', () => {
  it('각주가 붙은 문장만, 표식을 뺀 글로 고른다', () => {
    const draft =
      '연차 휴가 안내\n\n수습 기간은 3개월입니다.[[1]] 연차는 2년까지 이월됩니다. 점심은 12시입니다. [[2]][[1]]'
    expect(citedSentences(draft)).toEqual([
      { before: '수습 기간은 3개월입니다.', after: '수습 기간은 3개월입니다.', refs: [1] },
      { before: '점심은 12시입니다.', after: '점심은 12시입니다.', refs: [2, 1] },
    ])
  })

  it('각주가 없으면 빈 목록', () => {
    expect(citedSentences(original)).toEqual([])
  })
})

describe('changedSentences', () => {
  it('바뀐 문장만 원문·결과·근거 번호로 묶는다', () => {
    const draft =
      '연차 휴가 안내\n수습 기간은 3개월입니다. 연차는 1년까지만 이월됩니다.[[1]] 점심은 12시입니다.'
    expect(changedSentences(original, draft)).toEqual([
      { before: '연차는 2년까지 이월됩니다.', after: '연차는 1년까지만 이월됩니다.', refs: [1] },
    ])
  })

  it('이어서 바뀐 문장은 한 묶음, 떨어진 것은 따로', () => {
    const draft =
      '연차 휴가 안내\n수습 기간은 6개월입니다.[[1]] 연차는 1년까지 이월됩니다.[[2]] 점심은 12시입니다.'
    expect(changedSentences(original, draft)).toEqual([
      {
        before: '수습 기간은 3개월입니다. 연차는 2년까지 이월됩니다.',
        after: '수습 기간은 6개월입니다. 연차는 1년까지 이월됩니다.',
        refs: [1, 2],
      },
    ])
    const apart =
      '연차 휴가 안내\n수습 기간은 6개월입니다.[[1]] 연차는 2년까지 이월됩니다. 점심은 13시입니다.[[2]]'
    expect(changedSentences(original, apart).map((c) => c.refs)).toEqual([[1], [2]])
  })

  it('공백·줄바꿈 차이와 고치지 않은 문장의 각주는 바뀐 것으로 치지 않는다', () => {
    const draft =
      '연차 휴가 안내\n수습 기간은  3개월입니다.[[1]]\n연차는 2년까지 이월됩니다. 점심은 12시입니다.'
    expect(changedSentences(original, draft)).toEqual([])
  })

  it('이웃한 두 문단이 함께 바뀌면 문단마다 나눈다', () => {
    const before = ['수습은 3개월입니다.', '연차는 2년입니다.', '끝.'].join('\n')
    const draft = ['수습은 6개월입니다.[[1]]', '연차는 1년입니다.[[2]]', '끝.'].join('\n')
    expect(changedSentences(before, draft)).toEqual([
      { before: '수습은 3개월입니다.', after: '수습은 6개월입니다.', refs: [1] },
      { before: '연차는 2년입니다.', after: '연차는 1년입니다.', refs: [2] },
    ])
  })

  it('정규식 기호가 든 글도 글자 그대로 비교한다', () => {
    expect(changedSentences('값은 (a+b)*입니다.', '값은 (a+b)*입니다.')).toEqual([])
  })
})

describe('replaceSentence', () => {
  const editorOf = (content: string) =>
    new Editor({ element: null, extensions: docContentExtensions(), content })

  it('달라진 글자만 바꿔 문장 안 서식과 앞뒤 글을 남긴다', () => {
    const editor = editorOf(
      '<h2>안내</h2><p><strong>중요:</strong> 연차는 <em>2년까지</em> 이월됩니다. 점심은 12시입니다.</p>',
    )
    const item = { before: '연차는 2년까지 이월됩니다.', after: '연차는 1년까지 이월됩니다.', refs: [1] }
    expect(replaceSentence(editor, item)).toBe('done')
    expect(editor.getHTML()).toBe(
      '<h2>안내</h2><p><strong>중요:</strong> 연차는 <em>1년까지</em> 이월됩니다. 점심은 12시입니다.</p>',
    )
  })

  it('같은 글이 두 군데 있으면 어느 것인지 몰라 바꾸지 않는다', () => {
    const html = '<p>수습 기간은 3개월입니다.</p><table><tbody><tr><td><p>3개월</p></td></tr></tbody></table>'
    const editor = editorOf(html)
    expect(replaceSentence(editor, { before: '3개월', after: '6개월', refs: [1] })).toBe('manual')
    expect(editor.getHTML()).toBe(editorOf(html).getHTML())
  })

  it('두 문단에 걸친 묶음은 못 찾아 본문을 건드리지 않는다', () => {
    const html = '<p>수습은 3개월입니다.</p><p>연차는 2년입니다.</p>'
    const editor = editorOf(html)
    const item = { before: '수습은 3개월입니다. 연차는 2년입니다.', after: '바뀐 글', refs: [] }
    expect(replaceSentence(editor, item)).toBe('missing')
    expect(editor.getHTML()).toBe(html)
  })
})
