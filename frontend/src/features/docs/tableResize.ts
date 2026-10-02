import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ResizeState, TableMap, columnResizingPluginKey, pointsAtCell } from '@tiptap/pm/tables'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/**
 * `pos` 가 새 문서에서 어디로 갔는지. 두 문서에서 달라진 구간을 찾아, 그 앞이면 그대로, 뒤면 길이가
 * 달라진 만큼 민다. 달라진 구간 안이면 -1.
 *
 * Yjs 에서 온 변경은 문서 전체를 한 번에 갈아 끼우는 모양이라 ProseMirror 의 위치 매핑이 자리를 잃는다.
 * 끌기처럼 "지금 잡고 있는 자리" 를 들고 있는 플러그인은 남의 편집이 올 때 이걸로 자리를 다시 찾는다.
 *
 * ponytail: 달라진 구간 하나로 본다. 끄는 그 순간에 남이 그 표의 열을 더하면, 끼어든 칸이 잡고 있던
 * 칸과 모양이 같아 "내용만 바뀐 같은 칸" 으로 읽히고 너비가 새 열에 쓰인다(Ctrl+Z 로 돌아온다).
 * 거슬리면 Yjs 상대 위치로 칸 자체를 따라간다.
 */
function movedPos(before: PmNode, pos: number, after: PmNode): number {
  const start = before.content.findDiffStart(after.content)
  const end = before.content.findDiffEnd(after.content)
  if (start == null || !end) return pos
  // 같은 글자가 이어진 자리에 끼워 넣으면 앞에서 찾은 끝이 뒤에서 찾은 끝을 지나친다. 그만큼 되돌린다.
  const overlap = Math.max(0, start - Math.min(end.a, end.b))
  return pos < start ? pos : pos >= end.a + overlap ? pos + end.b - end.a : -1
}

/* ── 열 너비 (세로선) ───────────────────────────────────────── */

/**
 * 세로선 끌기가 남의 편집을 견디게 한다.
 *
 * 끌기 플러그인은 잡고 있는 칸의 자리를 위치 매핑으로 따라가는데, 남의 편집에서는 그 자리를 잃는다
 * (`movedPos`). 끄는 도중에 동료가 글자 하나만 쳐도 자리는 -1 이 되고 "끄는 중" 표시만 남아, 마우스를
 * 움직일 때마다 예외가 나고 놓아도 풀리지 않는다(문서를 다시 열 때까지 끌기를 못 쓴다). 그래서 남의
 * 편집으로 자리를 잃었을 때는 그 칸이 옮겨 간 자리를 다시 찾아 준다. 못 찾으면(내 편집으로 그 칸이
 * 사라진 경우도 같다) 끌기를 접는다.
 */
export function keepHandleAcrossRemoteEdits(plugin: Plugin) {
  const field = plugin.spec.state
  if (!field) return
  const apply = field.apply
  field.apply = function (tr, prev: ResizeState, oldState, newState) {
    const next = apply.call(this, tr, prev, oldState, newState) as ResizeState
    if (next.activeHandle > -1 || prev.activeHandle === -1 || !tr.docChanged) return next
    const moved = isChangeOrigin(tr) ? movedPos(oldState.doc, prev.activeHandle, tr.doc) : -1
    const pos = moved > -1 && pointsAtCell(tr.doc.resolve(moved)) ? moved : -1
    return new ResizeState(pos, pos > -1 && next.dragging)
  }
}

/**
 * 세로선 끌기를 놓을 때의 뒷정리 둘.
 *
 * 1. 끌지 않고 누르기만 한 것은 없던 일로 한다. 끌기 플러그인은 움직인 거리가 0 이어도 그 열의 지금
 *    너비를 문서에 쓴다. 세로선 근처를 눌러 커서를 두려던 것뿐인데 문서가 바뀌면 안 된다.
 * 2. 처음 끈 표는 나머지 열도 지금 보이는 너비로 굳힌다. 너비 없는 열이 하나라도 남아 있으면 표는
 *    본문 폭을 채우려 하고 그 열들이 남는 폭을 나눠 갖는다. 그러면 한 열을 좁혀도 옆 열이 그만큼
 *    넓어질 뿐 표의 폭은 그대로다. 모든 열에 너비가 있으면 표의 폭은 열 너비의 합이라, 어느 세로선을
 *    끌든 그 열만 바뀌고 표 전체 폭이 따라 변한다(맨 오른쪽 선을 끌면 표가 넓어지고 좁아진다).
 *
 * 놓는 순간의 변경과 같은 화면 갱신 안에서 덧붙이므로 Ctrl+Z 한 번에 같이 되돌아간다.
 */
export function settleColumnResize(cellMinWidth: number) {
  let view: EditorView | null = null

  return new Plugin({
    view(editorView) {
      view = editorView
      return {}
    },
    appendTransaction([root], oldState, newState) {
      const resize = columnResizingPluginKey.getState(oldState) as ResizeState | undefined
      if (!view || !resize || !resize.dragging || resize.activeHandle < 0) return null
      // 끌기를 놓는 것은 늘 내가 직접 보낸 트랜잭션이다. 끄는 중에 들어온 남의 변경이나 다른 플러그인이
      // 덧붙인 변경은 "놓은 것" 이 아니다. 남의 변경 뒤에는 잡은 자리가 새 문서 밖일 수도 있어, 여기서
      // 거르지 않으면 아래에서 예외가 나고 그 변경이 내 화면에 반영되지 못한다(그 뒤 내 입력이 남이
      // 지운 것을 되살린다).
      if (isChangeOrigin(root) || root.getMeta('appendedTransaction')) return null
      const handle = resize.activeHandle
      if (handle >= newState.doc.content.size) return null
      const before = oldState.doc.nodeAt(handle)
      const after = newState.doc.nodeAt(handle)
      // 끌기를 놓으면 잡은 칸의 너비가 바뀐다. 그게 아니면(끄는 중에 친 글 같은 다른 변경) 할 일이 없다.
      if (!before || !after || before.type !== after.type) return null
      if (before.attrs.colwidth === after.attrs.colwidth) return null
      const $cell = newState.doc.resolve(handle)
      if (!pointsAtCell($cell)) return null

      const table = $cell.node(-1)
      const start = $cell.start(-1)
      const map = TableMap.get(table)
      /** 그 칸의 너비 배열에서 `col` 열이 몇 번째인지. 합친 칸은 덮은 열마다 너비를 하나씩 갖는다. */
      const indexIn = (pos: number, col: number) => col - map.colCount(pos)
      /** `col` 열의 칸들. 세로로 합친 칸은 한 번만. */
      const cellsOf = (col: number) =>
        Array.from({ length: map.height }, (_, row) => map.map[row * map.width + col]).filter(
          (pos, row, all) => row === 0 || pos !== all[row - 1],
        )
      const tr = newState.tr

      // 끌기 플러그인은 잡은 칸의 오른쪽 끝 열을 바꾼다.
      const dragged = map.colCount(handle - start) + (after.attrs.colspan as number) - 1
      const index = indexIn(handle - start, dragged)
      const stillAt = (after.attrs.colwidth as number[] | null)?.[index] ?? 0
      if (!before.attrs.colwidth?.[index] && Math.abs(stillAt - resize.dragging.startWidth) < 1) {
        const untouched = oldState.doc.resolve(handle).node(-1)
        for (const pos of cellsOf(dragged))
          tr.setNodeMarkup(start + pos, null, untouched.nodeAt(pos)?.attrs)
        return tr
      }

      /**
       * `col` 열이 지금 화면에 그려진 폭. 놓는 변경은 아직 그려지기 전이라 사용자가 보고 있는 그대로다.
       * 그 열만 덮는 칸에서 잰다. 그런 칸이 없으면(모든 행에서 합쳐진 열) 합친 칸의 폭에서 너비를 아는
       * 열을 빼고 남은 열에 똑같이 나눈다.
       */
      const shownWidth = (col: number) => {
        const column = cellsOf(col)
        const pos = column.find((at) => table.nodeAt(at)?.attrs.colspan === 1) ?? column[0]
        const cell = table.nodeAt(pos)
        const dom = view?.nodeDOM(start + pos)
        if (!cell || !(dom instanceof HTMLElement)) return 0
        const known = ((cell.attrs.colwidth as number[] | null) ?? []).filter(Boolean)
        const rest = dom.offsetWidth - known.reduce((sum, width) => sum + width, 0)
        // 분모가 0 이면 무한대가 공유 문서에 쓰인다. 닿는 길은 못 찾았지만 값이 남는 곳이라 막아 둔다.
        return rest / Math.max(1, cell.attrs.colspan - known.length)
      }

      const widths = new Map<number, number[]>()
      for (let col = 0; col < map.width; col += 1) {
        const first = table.nodeAt(map.map[col])
        if (!first || first.attrs.colwidth?.[indexIn(map.map[col], col)]) continue
        const shown = shownWidth(col)
        for (const pos of cellsOf(col)) {
          const attrs = table.nodeAt(pos)?.attrs
          if (!attrs) continue
          const colwidth =
            widths.get(pos) ??
            (attrs.colwidth as number[] | null)?.slice() ??
            Array(attrs.colspan).fill(0)
          colwidth[indexIn(pos, col)] = Math.max(cellMinWidth, Math.round(shown))
          widths.set(pos, colwidth)
        }
      }
      widths.forEach((colwidth, pos) =>
        tr.setNodeMarkup(start + pos, null, { ...table.nodeAt(pos)?.attrs, colwidth }),
      )
      return tr.docChanged ? tr : null
    },
  })
}

/* ── 행 높이 (가로선) ───────────────────────────────────────── */

type RowResize = {
  /** 잡을 수 있는(또는 잡고 있는) 행 노드의 자리. 없으면 -1. */
  row: number
  dragging: { startY: number; startHeight: number } | null
  /** 끄는 동안 화면에만 보이는 높이. 놓을 때 문서에 쓴다. */
  height: number | null
}

const IDLE: RowResize = { row: -1, dragging: null, height: null }

export const rowResizingKey = new PluginKey<RowResize>('tableRowResizing')

/** 가로선 위아래로 이만큼 안에서 잡힌다. 세로선(표 확장의 handleWidth)과 같은 값. */
const HANDLE = 5
/** 본문 한 줄(28px)보다 낮게는 못 줄인다. */
const MIN_HEIGHT = 28

/** 포인터가 어느 행의 아래 가로선 근처에 있는지. 없으면 -1. */
function rowUnderPointer(view: EditorView, event: MouseEvent): number {
  const cell = event.target instanceof Element ? event.target.closest('td, th') : null
  if (!cell || !view.dom.contains(cell)) return -1
  const rect = cell.getBoundingClientRect()
  // 모서리에서는 세로선 끌기가 먼저다.
  if (event.clientX - rect.left <= HANDLE || rect.right - event.clientX <= HANDLE) return -1

  // 칸의 아래쪽이면 그 행, 위쪽이면 윗행의 가로선이다.
  // ponytail: 세로로 합친 칸은 시작한 행으로 본다. 합치기 UI 가 없어 붙여넣은 표에서만 나온다.
  const row =
    rect.bottom - event.clientY <= HANDLE
      ? cell.parentElement
      : event.clientY - rect.top <= HANDLE
        ? cell.parentElement?.previousElementSibling
        : null
  // posAtDOM 은 행 안쪽 첫 자리를 준다. 그 앞이 행 노드다.
  return row ? view.posAtDOM(row, 0) - 1 : -1
}

/**
 * 행 아래 가로선을 끌어 행 높이를 바꾼다. 표 확장에는 열 너비 끌기만 있어 같은 방식으로 만든 것이다.
 *
 * 높이는 행 속성(height)으로 문서에 남는다. 끄는 동안은 장식(decoration)으로 내 화면에만 보이고 놓을
 * 때 한 번 쓴다. 표의 행 높이는 "최소 높이" 라, 글이 그보다 길면 행은 그만큼 더 커진다.
 * 끌지 않고 누르기만 한 것은 쓰지 않는다.
 *
 * 끄는 동안의 높이는 장식에 `height` 로 직접 주지 않고 변수(`--row-height`)로 준다(그리는 것은
 * index.css). ProseMirror 는 장식이 빠질 때 장식이 쓰던 style 속성을 DOM 에서 지우는데, `height` 를
 * 쓰면 행이 제 속성으로 그려 둔 `height` 까지 같이 지워진다. 행 노드는 안 바뀌었으니 다시 그려지지도
 * 않아, 높이를 준 행의 가로선을 누르기만 해도 새로 고칠 때까지 그 행이 납작해 보인다.
 *
 * 표 편집 플러그인(칸 끌어 고르기)보다 앞에 둬야 한다. 뒤에 두면 가로선을 끄는 동안 칸 선택이 같이 돈다.
 */
export function rowResizing() {
  const stateOf = (view: EditorView) => rowResizingKey.getState(view.state) ?? IDLE
  const set = (view: EditorView, change: Partial<RowResize>) =>
    view.dispatch(view.state.tr.setMeta(rowResizingKey, change))

  return new Plugin<RowResize>({
    key: rowResizingKey,
    state: {
      init: () => IDLE,
      apply(tr, prev, oldState) {
        const change = tr.getMeta(rowResizingKey) as Partial<RowResize> | undefined
        if (change) return { ...prev, ...change }
        if (prev.row < 0 || !tr.docChanged) return prev
        const row = isChangeOrigin(tr)
          ? movedPos(oldState.doc, prev.row, tr.doc)
          : tr.mapping.map(prev.row, -1)
        // 그 자리가 더는 행이 아니면(행이 지워졌다) 끌기도 접는다.
        const node = row > -1 && row < tr.doc.content.size ? tr.doc.nodeAt(row) : null
        return node?.type.spec.tableRole === 'row' ? { ...prev, row } : IDLE
      },
    },
    props: {
      attributes: (state): Record<string, string> =>
        (rowResizingKey.getState(state)?.row ?? -1) > -1 ? { class: 'resize-cursor-row' } : {},
      decorations(state) {
        const { row, height } = rowResizingKey.getState(state) ?? IDLE
        const node = row > -1 ? state.doc.nodeAt(row) : null
        if (!node) return null
        return DecorationSet.create(state.doc, [
          Decoration.node(
            row,
            row + node.nodeSize,
            height == null
              ? { class: 'row-resize-active' }
              : {
                  class: 'row-resize-active row-resize-dragging',
                  style: `--row-height: ${height}px`,
                },
          ),
        ])
      },
      handleDOMEvents: {
        mousemove(view, event) {
          if (!view.editable || stateOf(view).dragging) return false
          const row = rowUnderPointer(view, event)
          if (row !== stateOf(view).row) set(view, { row })
          return false
        },
        mouseleave(view) {
          const { row, dragging } = stateOf(view)
          if (row > -1 && !dragging) set(view, { row: -1 })
          return false
        },
        mousedown(view, event) {
          const { row, dragging } = stateOf(view)
          const dom = row > -1 ? view.nodeDOM(row) : null
          // 왼쪽 버튼만. 오른쪽 버튼으로 시작하면 메뉴가 뜨면서 mouseup 을 못 받는다.
          if (!view.editable || dragging || event.button !== 0) return false
          if (!(dom instanceof HTMLElement)) return false

          const start = { startY: event.clientY, startHeight: dom.offsetHeight }
          const heightAt = (e: MouseEvent) =>
            Math.max(MIN_HEIGHT, Math.round(start.startHeight + e.clientY - start.startY))
          const win = view.dom.ownerDocument.defaultView ?? window

          /** 끌기를 끝낸다. `at` 이 있으면 그 자리의 높이를 쓰고, 없으면 버린다. */
          const finish = (at: MouseEvent | null) => {
            win.removeEventListener('mouseup', onUp)
            win.removeEventListener('mousemove', onMove)
            const now = stateOf(view)
            const tr = view.state.tr.setMeta(rowResizingKey, { dragging: null, height: null })
            // 남의 편집으로 행을 잃었으면 now.dragging 이 이미 비어 있다. 그때는 버린다.
            if (at && now.dragging && now.row > -1 && at.clientY !== start.startY)
              tr.setNodeAttribute(now.row, 'height', heightAt(at))
            view.dispatch(tr)
          }
          const onUp = (e: MouseEvent) => finish(e)
          const onMove = (e: MouseEvent) => {
            // 창 밖에서 놓았다가 돌아오면 mouseup 을 못 받는다. 버튼이 안 눌린 채 움직이면 버린다.
            // 그 자리의 높이로 쓰면 놓은 곳과 무관한 값이 기록된다.
            if (!e.buttons) return finish(null)
            if (stateOf(view).dragging) set(view, { height: heightAt(e) })
          }

          set(view, { dragging: start, height: start.startHeight })
          win.addEventListener('mouseup', onUp)
          win.addEventListener('mousemove', onMove)
          event.preventDefault()
          return true
        },
      },
    },
  })
}
