import { Editor } from '@tiptap/core'
import { expect, it } from 'vitest'
import { docContentExtensions } from './editorExtensions'
import { findText } from './findText'

function docOf(content: string) {
  return new Editor({ element: null, extensions: docContentExtensions(), content }).state.doc
}

it('서식이 섞인 블록에서도 그 글의 자리를 찾는다', () => {
  const doc = docOf('<p>머리말</p><ul><li><p>연차는 <strong>15일</strong>이다.</p></li></ul>')
  const range = findText(doc, '연차는 15일')
  expect(range).not.toBeNull()
  expect(doc.textBetween(range!.from, range!.to)).toBe('연차는 15일')
})

it('정규식 기호는 글자 그대로 비교하고, 블록에 걸친 글과 빈 글은 못 찾는다', () => {
  const doc = docOf('<p>금액(원) 1.5배</p><p>다음 블록</p>')
  expect(findText(doc, '(원) 1.5')).not.toBeNull()
  expect(findText(doc, '1.5.')).toBeNull()
  expect(findText(doc, '1.5배다음')).toBeNull()
  expect(findText(doc, '')).toBeNull()
})

it('줄바꿈은 getText 와 같은 글자로 비교한다', () => {
  const doc = docOf('<p>서울시 중구<br>세종대로 1</p>')
  const range = findText(doc, '중구\n세종대로')
  expect(range).not.toBeNull()
  expect(doc.textBetween(range!.from, range!.to, undefined, '\n')).toBe('중구\n세종대로')
})

it('after 를 주면 그 뒤의 자리를 찾는다', () => {
  const doc = docOf('<p>연차는 15일이다.</p><p>병가는 15일이다.</p>')
  const first = findText(doc, '15일')!
  const second = findText(doc, '15일', first.from + 1)!
  expect(second.from).toBeGreaterThan(first.from)
  expect(doc.textBetween(second.from - 4, second.to)).toBe('병가는 15일')
  expect(findText(doc, '15일', second.from + 1)).toBeNull()
})
