import { Editor } from '@tiptap/core'
import { expect, it } from 'vitest'
import { anchorBlock, anchoredBlocks, firstRowTableAnchor } from './blockId'
import { docContentExtensions } from './editorExtensions'

/** 화면 없이 문서 상태만 다룬다. 노드 뷰(React)를 띄우지 않는다. */
function editorWith(content: string) {
  return new Editor({ element: null, extensions: docContentExtensions(), content })
}

/** 그 글자가 문서에서 시작하는 위치. */
function posOf(editor: Editor, text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text)
  })
  return found
}

it('닻은 커서가 든 최상위 블록에 한 번만 준다', () => {
  const editor = editorWith('<p>앞</p><ul><li><p>항목</p></li></ul>')
  editor.commands.setTextSelection(posOf(editor, '항목'))

  const id = anchorBlock(editor)
  expect(id).toBeTruthy()
  // 항목 문단이 아니라 목록 전체에 걸린다. 다시 불러도 같은 닻이다.
  expect(editor.state.doc.child(1).attrs.blockId).toBe(id)
  expect(anchorBlock(editor)).toBe(id)
  expect(anchoredBlocks(editor.state.doc)).toEqual({ [id!]: '항목' })
})

it('커서가 표의 첫 행에 있을 때만 그 표의 닻을 돌려준다', () => {
  const editor = editorWith(
    '<table><tr><th><p>머리</p></th></tr><tr><td><p>본문</p></td></tr></table><p>바깥</p>',
  )
  editor.commands.setTextSelection(posOf(editor, '본문'))
  const id = anchorBlock(editor)
  expect(id).toBeTruthy()

  expect(firstRowTableAnchor(editor.state)).toBeNull()
  editor.commands.setTextSelection(posOf(editor, '머리'))
  expect(firstRowTableAnchor(editor.state)).toBe(id)
  editor.commands.setTextSelection(posOf(editor, '바깥'))
  expect(firstRowTableAnchor(editor.state)).toBeNull()
})
