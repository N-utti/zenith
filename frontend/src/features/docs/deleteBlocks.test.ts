import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { expect, it } from 'vitest'
import { deleteSelectedBlocks } from './deleteBlocks'
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

/** `first` 부터 `last` 까지 글자를 고르고 블록 지우기를 누른 뒤의 문서 구조. */
function trash(content: string, first: string, last = first): string {
  const editor = editorWith(content)
  editor
    .chain()
    .setTextSelection({ from: posOf(editor, first), to: posOf(editor, last) + last.length })
    .command(({ tr }) => deleteSelectedBlocks(tr))
    .run()
  return editor.state.doc.toString()
}

it('고른 글자가 아니라 그 글이 든 블록을 지운다', () => {
  expect(trash('<p>하나 둘</p><p>셋</p>', '둘')).toBe('doc(paragraph("셋"))')
  // 블록이 하나뿐이면 빈 문단이 남는다. 문서는 비어 있을 수 없다.
  expect(trash('<p>하나</p>', '하나')).toBe('doc(paragraph)')

  // 사진은 글이 아니라 블록 자체가 골라진다(노드 선택).
  const image = editorWith('<p>앞</p><img src="/api/files/f-1"><p>뒤</p>')
  image
    .chain()
    .setNodeSelection(posOf(image, '앞') + 2)
    .command(({ tr }) => deleteSelectedBlocks(tr))
    .run()
  expect(image.state.doc.toString()).toBe('doc(paragraph("앞"), paragraph("뒤"))')
})

it('목록에서는 그 항목만 지우고, 마지막 항목이면 목록까지 걷는다', () => {
  expect(trash('<ul><li><p>가</p></li><li><p>나</p></li><li><p>다</p></li></ul>', '나')).toBe(
    'doc(bulletList(listItem(paragraph("가")), listItem(paragraph("다"))))',
  )
  expect(trash('<p>앞</p><ul><li><p>가</p></li></ul>', '가')).toBe('doc(paragraph("앞"))')
})

it('문단에서 목록 첫 항목까지 고르면 고르지 않은 항목은 남는다', () => {
  const content = '<p>앞</p><ul><li><p>가</p></li><li><p>나</p></li></ul><p>뒤</p>'
  expect(trash(content, '앞', '가')).toBe(
    'doc(bulletList(listItem(paragraph("나"))), paragraph("뒤"))',
  )
  // 목록 끝 항목에서 다음 문단까지. 앞 항목은 남는다.
  expect(trash(content, '나', '뒤')).toBe(
    'doc(paragraph("앞"), bulletList(listItem(paragraph("가"))))',
  )
})

it('선택의 끝만 걸치고 글자는 고르지 않은 블록은 남긴다', () => {
  const content = '<p>앞</p><ul><li><p>가</p></li><li><p>나</p></li></ul><p>뒤</p>'
  const select = (from: number, to: number) => {
    const editor = editorWith(content)
    editor
      .chain()
      .setTextSelection({ from, to })
      .command(({ tr }) => deleteSelectedBlocks(tr))
      .run()
    return editor.state.doc.toString()
  }
  const probe = editorWith(content)

  // Shift+↓ 로 고른 모양: 「앞」 줄 전체와 「가」 의 맨 앞까지. 「가」 는 남는다.
  expect(select(posOf(probe, '앞'), posOf(probe, '가'))).toBe(
    'doc(bulletList(listItem(paragraph("가")), listItem(paragraph("나"))), paragraph("뒤"))',
  )
  // 「가」 의 맨 끝에서 「나」 까지. 「가」 는 남는다.
  expect(select(posOf(probe, '가') + 1, posOf(probe, '나') + 1)).toBe(
    'doc(paragraph("앞"), bulletList(listItem(paragraph("가"))), paragraph("뒤"))',
  )
})

it('표의 칸 안에서는 칸을 비우기만 하고, 칸 경계를 넘는 선택은 건드리지 않는다', () => {
  const content = '<p>앞</p><table><tr><td><p>가</p></td><td><p>나</p></td></tr></table>'
  const untouched = editorWith(content).state.doc.toString()

  expect(trash(content, '가')).toBe(
    'doc(paragraph("앞"), table(tableRow(tableCell(paragraph), tableCell(paragraph("나")))))',
  )
  // 표 밖에서 칸 안까지.
  expect(trash(content, '앞', '가')).toBe(untouched)

  // 칸 여러 개. 칸 바로 앞 위치는 글자 위치에서 문단과 칸의 여는 자리만큼 뺀 곳이다.
  const cells = editorWith(content)
  const selection = CellSelection.create(
    cells.state.doc,
    posOf(cells, '가') - 2,
    posOf(cells, '나') - 2,
  )
  cells.commands.command(({ tr }) => deleteSelectedBlocks(tr.setSelection(selection)))
  expect(cells.state.doc.toString()).toBe(untouched)
})
