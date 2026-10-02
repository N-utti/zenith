import type { Extensions } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Plugin } from '@tiptap/pm/state'
import {
  ResizeState,
  columnResizingPluginKey,
  pointsAtCell,
  tableEditingKey,
  updateColumnsOnResize,
} from '@tiptap/pm/tables'

/**
 * 표를 그리는 뷰. 표 확장(3.30.5)의 것은 열을 더하거나 지워 열 자리가 밀릴 때, 너비가 없어진 자리의
 * `<col>` 에 예전 너비를 남긴다(min-width 만 쓰고 width 를 지우지 않는다). 그러면 방금 넣은 빈 열이
 * 옆 열의 너비로 그려지고 새로 고쳐야 풀린다. 세로선을 끄는 동안 쓰이는 prosemirror-tables 의
 * 함수는 width 를 제대로 지우므로, 문서가 바뀔 때도 그 함수로 열 너비를 다시 쓴다.
 */
class ColumnWidthTableView extends TableView {
  update(node: PmNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    updateColumnsOnResize(node, this.colgroup, this.table, this.cellMinWidth)
    return true
  }
}

/**
 * `pos` 가 가리키던 칸이 새 문서에서 어디로 갔는지. 두 문서에서 달라진 구간을 찾아, 그 앞이면 그대로,
 * 뒤면 길이가 달라진 만큼 민다. 달라진 구간 안이거나 옮긴 자리가 칸이 아니면 -1.
 */
function samePlace(before: PmNode, pos: number, after: PmNode): number {
  const start = before.content.findDiffStart(after.content)
  const end = before.content.findDiffEnd(after.content)
  if (start == null || !end) return pos
  // 같은 글자가 이어진 자리에 끼워 넣으면 앞에서 찾은 끝이 뒤에서 찾은 끝을 지나친다. 그만큼 되돌린다.
  const overlap = Math.max(0, start - Math.min(end.a, end.b))
  const moved = pos < start ? pos : pos >= end.a + overlap ? pos + end.b - end.a : -1
  return moved > -1 && pointsAtCell(after.resolve(moved)) ? moved : -1
}

/**
 * 세로선 끌기가 남의 편집을 견디게 한다.
 *
 * 끌기 플러그인은 잡고 있는 칸의 자리를 위치 매핑으로 따라간다. 그런데 Yjs 에서 온 변경은 문서 전체를
 * 한 번에 갈아 끼우는 모양이라 매핑이 자리를 잃는다. 끄는 도중에 동료가 글자 하나만 쳐도 자리는 -1 이
 * 되고 «끄는 중» 표시만 남아, 마우스를 움직일 때마다 예외가 나고 놓아도 풀리지 않는다(문서를 다시
 * 열 때까지 끌기를 못 쓴다). 그래서 남의 편집으로 자리를 잃었을 때는 그 칸이 옮겨 간 자리를 다시 찾아
 * 준다. 못 찾으면(내 편집으로 그 칸이 사라진 경우도 같다) 끌기를 접는다.
 *
 * ponytail: 달라진 구간 하나로 본다. 끄는 그 순간에 남이 그 표의 열을 더하면, 끼어든 칸이 잡고 있던
 * 칸과 모양이 같아 «내용만 바뀐 같은 칸» 으로 읽히고 너비가 새 열에 쓰인다(Ctrl+Z 로 돌아온다).
 * 거슬리면 Yjs 상대 위치로 칸 자체를 따라간다.
 */
function keepHandleAcrossRemoteEdits(plugin: Plugin) {
  const field = plugin.spec.state
  if (!field) return
  const apply = field.apply
  field.apply = function (tr, prev: ResizeState, oldState, newState) {
    const next = apply.call(this, tr, prev, oldState, newState) as ResizeState
    if (next.activeHandle > -1 || prev.activeHandle === -1 || !tr.docChanged) return next
    const pos = isChangeOrigin(tr) ? samePlace(oldState.doc, prev.activeHandle, tr.doc) : -1
    return new ResizeState(pos, pos > -1 && next.dragging)
  }
}

/**
 * 남의 편집 뒤에 표 확장이 표를 맞춰 쓴 변경(칸 수·열 너비가 어긋난 행 고치기)은 내 되돌리기 기록에
 * 넣지 않는다.
 *
 * 넣으면 되돌리기가 맴돈다. 내가 열 너비를 바꾼 뒤 동료가 그 표에 행을 더하면 새 행은 너비를 물려받는다.
 * 내가 너비를 되돌리면 그 행에만 너비가 남아 표가 어긋나고, 표 확장이 다시 맞춘다. 그 맞춤이 내 기록의
 * 새 항목이 되면 다음 Ctrl+Z 는 그 항목만 되돌리고, 표는 또 어긋나 또 맞춰진다.
 *
 * 내 편집 뒤의 맞춤은 건드리지 않는다. 같은 화면 갱신 안에서는 마지막 트랜잭션의 값이 전체에 적용돼,
 * 여기서 빼면 내 편집까지 기록에서 빠진다(blockId.ts 와 같은 사정).
 *
 * 대가: 위 상황에서 너비를 끝까지 되돌린 뒤의 다시 실행(Ctrl+Y)은 너비를 되살리지 못한다. 맞춤이 그
 * 칸에 기록 밖에서 값을 다시 썼기 때문에 Yjs 가 다시 실행을 충돌로 보고 버린다.
 */
function keepFixupsOutOfHistory(plugin: Plugin) {
  const append = plugin.spec.appendTransaction
  if (!append) return
  plugin.spec.appendTransaction = function (trs, oldState, newState) {
    const fix = append.call(this, trs, oldState, newState)
    if (fix?.docChanged && trs.every((tr) => isChangeOrigin(tr))) fix.setMeta('addToHistory', false)
    return fix
  }
}

const DocTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? []
    for (const plugin of plugins) {
      if (plugin.spec.key === columnResizingPluginKey) keepHandleAcrossRemoteEdits(plugin)
      if (plugin.spec.key === tableEditingKey) keepFixupsOutOfHistory(plugin)
    }
    return plugins
  },
})

/**
 * 표. 행·열 편집은 서식 툴바의 표 메뉴(editorControls 의 TableMenu)가 맡는다.
 *
 * resizable: 세로선을 끌어 열 너비를 바꾼다. 너비는 셀 속성(colwidth)으로 문서에 남아 같이 보는
 * 사람에게도 전해진다. 끄는 동안은 내 화면만 바뀌고 놓을 때 한 번 쓰므로, 두 사람이 같은 열을
 * 끌면 나중에 놓은 쪽 값이 남는다. 손가락 기기에서는 끈다. 끌 수 없는데도 세로선 근처를 누르면
 * 그 누름이 «끌기 시작과 끝» 으로 읽혀 커서 대신 너비가 기록된다. 저장된 너비는 그대로 그려진다.
 * cellMinWidth 는 index.css 의 칸 최소 폭(min-w-16)과 같은 값이다.
 * 셀 내용을 문단으로 제한해 셀 안에 표가 들어가는 것을 스키마에서 막는다.
 */
export function tableExtensions(): Extensions {
  return [
    DocTable.configure({
      // matchMedia 는 테스트 환경(jsdom)에 없다.
      resizable: !window.matchMedia?.('(pointer: coarse)').matches,
      cellMinWidth: 64,
      View: ColumnWidthTableView,
    }),
    TableRow,
    TableCell.extend({ content: 'paragraph+' }),
    TableHeader.extend({ content: 'paragraph+' }),
  ]
}
