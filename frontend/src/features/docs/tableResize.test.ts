import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { columnResizingPluginKey } from '@tiptap/pm/tables'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeEach, expect, it } from 'vitest'
import * as Y from 'yjs'
import { docContentExtensions } from './editorExtensions'

const TABLE =
  '<table><tr><th><p>가</p></th><th><p>나</p></th></tr><tr><td><p>다</p></td><td><p>라</p></td></tr></table>'

function collabEditor(doc: Y.Doc) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...docContentExtensions(), Collaboration.configure({ document: doc })],
  })
}

/** 같은 문서를 연 두 사람. 한쪽의 편집이 곧바로 다른 쪽에 닿는다. */
function pair() {
  const mine = new Y.Doc()
  const theirs = new Y.Doc()
  mine.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(theirs, update, 'relay')
  })
  theirs.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(mine, update, 'relay')
  })
  return { a: collabEditor(mine), b: collabEditor(theirs) }
}

/** 표의 칸들. 문서 순서(행 먼저)대로. */
function cells(editor: Editor): { pos: number; col: number; colwidth: number[] | null }[] {
  const found: { pos: number; col: number; colwidth: number[] | null }[] = []
  editor.state.doc.descendants((node, pos, _parent, index) => {
    if (['tableCell', 'tableHeader'].includes(node.type.name))
      found.push({ pos, col: index, colwidth: node.attrs.colwidth as number[] | null })
  })
  return found
}

/** 그 열의 칸마다 적힌 너비. */
const widthsOf = (editor: Editor, col: number) =>
  cells(editor)
    .filter((cell) => cell.col === col)
    .map((cell) => cell.colwidth)

const resizing = (editor: Editor) => columnResizingPluginKey.getState(editor.state)

/**
 * 첫 열의 세로선을 잡고 `to` 픽셀 너비까지 끈다. `meanwhile` 은 누른 채로 있는 동안 벌어지는 일.
 *
 * jsdom 에는 배치가 없어 포인터가 세로선 위에 있는지를 편집기가 알 수 없다. 그 판정(손잡이 자리)만
 * 직접 넣고, 누르고 끌고 놓는 것은 실제 이벤트로 보낸다. 칸 폭이 0 으로 재어지므로 끈 거리가 곧 너비다.
 */
function dragFirstColumn(editor: Editor, to: number, meanwhile?: () => void) {
  const mouse = (type: string, clientX: number) =>
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      buttons: 1,
      which: 1,
    } as MouseEventInit)
  editor.view.dispatch(
    editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: cells(editor)[0].pos }),
  )
  editor.view.dom.dispatchEvent(mouse('mousedown', 0))
  meanwhile?.()
  window.dispatchEvent(mouse('mousemove', to))
  window.dispatchEvent(mouse('mouseup', to))
}

// 끌기 플러그인은 window 에 건 리스너 안에서 돈다. 거기서 난 예외는 테스트를 실패시키지 않으므로 따로 모은다.
let errors: string[] = []
const onError = (event: ErrorEvent) => {
  errors.push(event.message)
  event.preventDefault()
}
beforeEach(() => {
  errors = []
  window.addEventListener('error', onError)
})
afterEach(() => window.removeEventListener('error', onError))

it('세로선을 끌어 바꾼 열 너비는 문서에 남아 같이 보는 사람의 표에도 그려진다', () => {
  const { a, b } = pair()
  a.commands.setContent(TABLE)

  dragFirstColumn(a, 200)

  expect(widthsOf(a, 0)).toEqual([[200], [200]])
  expect(widthsOf(b, 0)).toEqual([[200], [200]])
  expect(b.view.dom.querySelector('col')?.style.width).toBe('200px')
  expect(errors).toEqual([])
})

it('끄는 도중에 남의 편집이 들어와도 끌기가 이어진다', () => {
  const { a, b } = pair()
  a.commands.setContent(`${TABLE}<p>꼬리</p>`)

  // 누르고 있는 사이 다른 사람이 표 밖에서 글자를 친다.
  dragFirstColumn(a, 200, () => b.commands.insertContentAt(b.state.doc.content.size - 1, '글'))

  expect(a.getText()).toContain('꼬리글')
  expect(widthsOf(a, 0)).toEqual([[200], [200]])
  expect(resizing(a)?.dragging).toBeFalsy()
  expect(errors).toEqual([])
})

it('끄는 도중에 남이 표 위에 블록을 넣어도 잡고 있던 표의 열이 바뀐다', () => {
  const { a, b } = pair()
  // 표가 둘이면 자리를 순번으로 찾을 때 밀려난 자리에 온 다른 표를 잡는다.
  a.commands.setContent(`${TABLE}${TABLE}`)
  const secondTable = (editor: Editor) =>
    cells(editor)
      .slice(4)
      .filter((cell) => cell.col === 0)
      .map((cell) => cell.colwidth)

  // 둘째 표의 첫 열을 잡는다.
  const mouse = (type: string, clientX: number) =>
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      buttons: 1,
      which: 1,
    } as MouseEventInit)
  a.view.dispatch(a.state.tr.setMeta(columnResizingPluginKey, { setHandle: cells(a)[4].pos }))
  a.view.dom.dispatchEvent(mouse('mousedown', 0))
  b.commands.insertContentAt(0, '<p>머리</p>')
  window.dispatchEvent(mouse('mousemove', 200))
  window.dispatchEvent(mouse('mouseup', 200))

  expect(a.getText()).toContain('머리')
  expect(widthsOf(a, 0).slice(0, 2)).toEqual([null, null])
  expect(secondTable(a)).toEqual([[200], [200]])
  expect(errors).toEqual([])
})

it('끄는 도중에 남이 잡고 있던 칸의 행을 지우면 끌기를 깨끗이 접는다', () => {
  const { a, b } = pair()
  a.commands.setContent(TABLE)

  dragFirstColumn(a, 200, () =>
    b
      .chain()
      .setTextSelection(cells(b)[0].pos + 2)
      .deleteRow()
      .run(),
  )

  // 끌던 것은 버린다. 예외도, 끄는 중이라는 표시도 남지 않아야 다음 끌기가 된다.
  expect(cells(a).map((cell) => cell.colwidth)).toEqual([null, null])
  expect(resizing(a)).toMatchObject({ activeHandle: -1, dragging: false })
  expect(errors).toEqual([])

  dragFirstColumn(a, 150)
  expect(widthsOf(a, 0)).toEqual([[150]])
})

it('너비를 준 열 앞에 열을 더하면 새 열은 그 너비를 물려받지 않는다', () => {
  const editor = collabEditor(new Y.Doc())
  editor.commands.setContent(TABLE)
  dragFirstColumn(editor, 200)

  // 첫 칸 안에 커서를 두고 왼쪽에 열을 더한다. 너비 200 인 열은 둘째 자리로 밀린다.
  editor
    .chain()
    .setTextSelection(cells(editor)[0].pos + 2)
    .addColumnBefore()
    .run()

  const widths = [...editor.view.dom.querySelectorAll('col')].map((col) => col.style.width)
  expect(widths).toEqual(['', '200px', ''])
})

it('남이 행을 더한 표에서 내 열 너비를 되돌려도 그 앞의 편집까지 되돌릴 수 있다', () => {
  const { a, b } = pair()
  const undoManager = yUndoPluginKey.getState(a.state)?.undoManager as Y.UndoManager
  // 화면이 한 번 더 갱신되는 것. 표 고치기가 쓴 변경은 이때 Y.Doc 으로 나간다.
  const settle = (editor: Editor) => editor.view.dispatch(editor.state.tr.setMeta('settle', true))

  a.commands.setContent(TABLE)
  undoManager.stopCapturing()
  a.chain()
    .setTextSelection(cells(a)[3].pos + 2)
    .insertContent('Z')
    .run()
  undoManager.stopCapturing()
  dragFirstColumn(a, 200)
  undoManager.stopCapturing()

  // 새 행은 열 너비를 물려받는다. 내가 너비를 되돌리면 이 행에만 너비가 남아 표가 어긋나고,
  // 표 확장이 그걸 다시 맞춘다. 그 맞춤이 내 되돌리기 기록에 들어가면 Ctrl+Z 가 거기서 맴돈다.
  b.chain()
    .setTextSelection(cells(b)[2].pos + 2)
    .addRowAfter()
    .run()

  for (let i = 0; i < 4; i += 1) {
    a.commands.undo()
    settle(a)
    settle(b)
  }

  expect(a.getText()).not.toContain('Z')
})
