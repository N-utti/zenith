import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { columnResizingPluginKey } from '@tiptap/pm/tables'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { docContentExtensions } from './editorExtensions'
import { rowResizingKey } from './tableResize'

const TABLE =
  '<table><tr><th><p>가</p></th><th><p>나</p></th></tr><tr><td><p>다</p></td><td><p>라</p></td></tr></table>'

/**
 * 테스트가 띄운 편집기들. 테스트가 끝나면 닫는다. 안 닫으면 편집기가 걸어 둔 타이머가 테스트 환경
 * (jsdom)이 내려간 뒤에 돌아 `document is not defined` 가 나고, 테스트는 다 통과했는데도 실행 전체가
 * 실패로 끝난다(타이밍에 따라 가끔만).
 */
const editors: Editor[] = []

function collabEditor(doc: Y.Doc) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...docContentExtensions(), Collaboration.configure({ document: doc })],
  })
  editors.push(editor)
  return editor
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
 * `cell` 번째 칸의 오른쪽 세로선을 잡고 `to` 픽셀 너비까지 끈다. `meanwhile` 은 누른 채로 있는
 * 동안 벌어지는 일.
 *
 * jsdom 에는 배치가 없어 포인터가 세로선 위에 있는지를 편집기가 알 수 없다. 그 판정(손잡이 자리)만
 * 직접 넣고, 누르고 끌고 놓는 것은 실제 이벤트로 보낸다. 칸 폭이 0 으로 재어지므로 끈 거리가 곧 너비다.
 */
function dragColumn(editor: Editor, cell: number, to: number, meanwhile?: () => void) {
  const mouse = (type: string, clientX: number) =>
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      buttons: 1,
      which: 1,
    } as MouseEventInit)
  editor.view.dispatch(
    editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: cells(editor)[cell].pos }),
  )
  editor.view.dom.dispatchEvent(mouse('mousedown', 0))
  meanwhile?.()
  window.dispatchEvent(mouse('mousemove', to))
  window.dispatchEvent(mouse('mouseup', to))
}

const dragFirstColumn = (editor: Editor, to: number, meanwhile?: () => void) =>
  dragColumn(editor, 0, to, meanwhile)

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
afterEach(() => {
  window.removeEventListener('error', onError)
  for (const editor of editors.splice(0)) editor.destroy()
  vi.restoreAllMocks()
})

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

  // 끝 열은 끌 때 같이 굳은 너비다(jsdom 에서는 칸 폭이 0 이라 최소 폭 64 가 된다).
  const widths = [...editor.view.dom.querySelectorAll('col')].map((col) => col.style.width)
  expect(widths).toEqual(['', '200px', '64px'])
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

/** 칸이 화면에 120px 로 그려져 있다고 친다. jsdom 은 늘 0 을 준다. */
const drawnAt120 = () => vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)

it('처음 끈 표는 나머지 열도 보이는 너비로 굳고, 되돌리기 한 번에 같이 풀린다', () => {
  drawnAt120()
  const { a, b } = pair()
  const undoManager = yUndoPluginKey.getState(a.state)?.undoManager as Y.UndoManager
  a.commands.setContent(TABLE)
  undoManager.stopCapturing()

  // 120 이던 첫 열을 80 만큼 넓힌다.
  dragFirstColumn(a, 80)

  // 끌지 않은 둘째 열에도 너비가 생긴다. 그래야 표의 폭이 열 너비의 합이 되어, 다음부터는 어느
  // 세로선을 끌든 표 전체 폭이 따라 변한다.
  expect(cells(b).map((cell) => cell.colwidth)).toEqual([[200], [120], [200], [120]])
  expect(a.view.dom.querySelector('table')?.style.width).toBe('320px')

  a.commands.undo()
  expect(cells(a).map((cell) => cell.colwidth)).toEqual([null, null, null, null])
})

it('세로선을 끌지 않고 누르기만 하면 문서가 바뀌지 않는다', () => {
  drawnAt120()
  const { a, b } = pair()
  const undoManager = yUndoPluginKey.getState(a.state)?.undoManager as Y.UndoManager
  a.commands.setContent(TABLE)
  undoManager.stopCapturing()
  const recorded = undoManager.undoStack.length

  dragFirstColumn(a, 0)

  expect(cells(a).map((cell) => cell.colwidth)).toEqual([null, null, null, null])
  expect(cells(b).map((cell) => cell.colwidth)).toEqual([null, null, null, null])
  expect(undoManager.undoStack.length).toBe(recorded)
  expect(errors).toEqual([])
})

/** 행마다 적힌 높이. */
function heights(editor: Editor): (number | null)[] {
  const found: (number | null)[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') found.push(node.attrs.height as number | null)
  })
  return found
}

/**
 * 첫 행의 아래 가로선을 잡고 `by` 픽셀 내린다. 세로선과 같이, 포인터가 가로선 위에 있다는 판정만
 * 직접 넣는다. 행 높이가 0 으로 재어지므로 내린 거리가 곧 높이다(28 보다 작으면 28).
 */
function dragFirstRow(editor: Editor, by: number, meanwhile?: () => void) {
  const mouse = (type: string, clientY: number) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientY, buttons: 1 })
  let row = -1
  editor.state.doc.descendants((node, pos) => {
    if (row < 0 && node.type.name === 'tableRow') row = pos
  })
  editor.view.dispatch(editor.state.tr.setMeta(rowResizingKey, { row }))
  editor.view.dom.dispatchEvent(mouse('mousedown', 0))
  meanwhile?.()
  window.dispatchEvent(mouse('mousemove', by))
  window.dispatchEvent(mouse('mouseup', by))
}

it('가로선을 끌어 바꾼 행 높이는 문서에 남아 같이 보는 사람의 표에도 그려진다', () => {
  const { a, b } = pair()
  a.commands.setContent(TABLE)

  dragFirstRow(a, 60)

  expect(heights(a)).toEqual([60, null])
  expect(heights(b)).toEqual([60, null])
  expect(b.view.dom.querySelector('tr')?.style.height).toBe('60px')
  expect(rowResizingKey.getState(a.state)).toMatchObject({ dragging: null, height: null })
  expect(errors).toEqual([])
})

it('가로선을 끌지 않고 누르기만 하면 높이를 쓰지 않는다', () => {
  const { a } = pair()
  a.commands.setContent(TABLE)

  dragFirstRow(a, 0)

  expect(heights(a)).toEqual([null, null])
})

it('가로선을 끄는 도중에 남의 편집이 들어와도 잡고 있던 행의 높이가 바뀐다', () => {
  const { a, b } = pair()
  a.commands.setContent(TABLE)

  dragFirstRow(a, 60, () => b.commands.insertContentAt(0, '<p>머리</p>'))

  expect(a.getText()).toContain('머리')
  expect(heights(a)).toEqual([60, null])
  expect(errors).toEqual([])
})

it('가로선을 끄는 도중에 남이 그 표를 지우면 끌기를 깨끗이 접는다', () => {
  const { a, b } = pair()
  a.commands.setContent(`${TABLE}<p>꼬리</p>`)

  dragFirstRow(a, 60, () =>
    b
      .chain()
      .setTextSelection(cells(b)[0].pos + 2)
      .deleteTable()
      .run(),
  )

  expect(heights(a)).toEqual([])
  expect(rowResizingKey.getState(a.state)).toMatchObject({ row: -1, dragging: null })
  expect(errors).toEqual([])
})

it('세로선을 끄는 도중에 남이 그 표를 지워도 오류 없이 지워진 대로 보인다', () => {
  const { a, b } = pair()
  a.commands.setContent(`<p>머리</p>${TABLE}`)

  // 표의 마지막 칸을 잡는다. 표가 사라지면 그 자리는 새 문서의 길이를 넘는다.
  dragColumn(a, 3, 200, () =>
    b
      .chain()
      .setTextSelection(cells(b)[0].pos + 2)
      .deleteTable()
      .run(),
  )

  // 여기서 예외가 나면 남의 삭제가 내 화면에 반영되지 않고, 내 다음 입력이 지워진 표를 되살린다.
  expect(cells(a)).toEqual([])
  expect(a.getText()).not.toContain('가')
  expect(resizing(a)).toMatchObject({ activeHandle: -1, dragging: false })
  expect(errors).toEqual([])
})

it('높이를 준 행의 가로선을 누르기만 해도 그 행의 높이가 화면에서 풀리지 않는다', () => {
  // 행이 화면에 100px 로 그려져 있다고 친다.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
  const { a } = pair()
  a.commands.setContent(TABLE)
  dragFirstRow(a, 20)
  expect(a.view.dom.querySelector('tr')?.style.height).toBe('120px')

  dragFirstRow(a, 0)

  expect(heights(a)).toEqual([120, null])
  expect(a.view.dom.querySelector('tr')?.style.height).toBe('120px')
})

it('첫 행이 가로로 합친 칸이어도 나머지 열은 그 열만 덮는 칸의 폭으로 굳는다', () => {
  // 합친 칸은 470px, 나머지 칸은 120px 로 그려져 있다고 친다.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this as HTMLTableCellElement).colSpan === 2 ? 470 : 120
  })
  const { a } = pair()
  a.commands.setContent(
    '<table><tr><th colspan="2"><p>합</p></th></tr><tr><td><p>다</p></td><td><p>라</p></td></tr></table>',
  )

  // 둘째 행의 첫 열을 120 에서 350 으로 넓힌다.
  dragColumn(a, 1, 230)

  // 둘째 열은 끌지 않았으니 보이던 120 그대로여야 한다. 합친 칸의 폭을 반으로 나누면 235 가 된다.
  expect(cells(a).map((cell) => cell.colwidth)).toEqual([[350, 120], [350], [120]])
})

it('붙여넣은 행 높이는 px 값만 받는다', () => {
  const editor = collabEditor(new Y.Doc())
  const row = (height: string) => `<tr style="height: ${height}"><td><p>가</p></td></tr>`
  editor.commands.setContent(`<table>${row('40px')}${row('15.75pt')}${row('50%')}</table>`)

  expect(heights(editor)).toEqual([40, null, null])
})
