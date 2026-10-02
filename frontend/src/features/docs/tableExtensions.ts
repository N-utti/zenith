import type { Extensions } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Plugin } from '@tiptap/pm/state'
import { columnResizingPluginKey, tableEditingKey, updateColumnsOnResize } from '@tiptap/pm/tables'
import { keepHandleAcrossRemoteEdits, rowResizing, settleColumnResize } from './tableResize'

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
    let resizable = false
    for (const plugin of plugins) {
      if (plugin.spec.key === tableEditingKey) keepFixupsOutOfHistory(plugin)
      if (plugin.spec.key === columnResizingPluginKey) {
        keepHandleAcrossRemoteEdits(plugin)
        resizable = true
      }
    }
    // 끌기 플러그인이 붙었을 때(끌 수 있는 기기의 편집 화면)만 행 높이 끌기도 붙인다.
    // 순서: 행 높이 끌기는 표 편집 플러그인보다 앞이어야 한다(rowResizing 의 설명).
    return resizable
      ? [rowResizing(), settleColumnResize(this.options.cellMinWidth), ...plugins]
      : plugins
  },
})

const DocTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 행 아래 가로선을 끌어 준 높이(px). 표의 행 높이는 «최소 높이» 라 글이 더 길면 그만큼 더 커진다.
      // 읽을 때는 px 값만 받는다. 엑셀·워드에서 붙여넣은 표는 행마다 pt·% 높이를 싣고 오는데,
      // 숫자만 떼어 px 로 읽으면 다른 높이가 된다. 그런 값은 버리고 내용에 맞는 높이로 둔다.
      height: {
        default: null,
        parseHTML: (element) => {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(element.style.height)
          return px ? Math.round(Number(px[1])) : null
        },
        renderHTML: (attrs) => (attrs.height ? { style: `height: ${attrs.height}px` } : {}),
      },
    }
  },
})

/**
 * 표. 행·열 편집은 표 메뉴(editorControls 의 TableMenu)가, 크기는 끌기(tableResize)가 맡는다.
 *
 * resizable: 세로선을 끌어 열 너비를, 가로선을 끌어 행 높이를 바꾼다. 크기는 칸·행 속성(colwidth,
 * height)으로 문서에 남아 같이 보는 사람에게도 전해진다. 끄는 동안은 내 화면만 바뀌고 놓을 때 한 번
 * 쓰므로, 두 사람이 같은 선을 끌면 나중에 놓은 쪽 값이 남는다. 손가락 기기에서는 끈다. 끌 수 없는데도
 * 선 근처를 누르면 그 누름이 «끌기 시작과 끝» 으로 읽혀 커서가 잡히지 않는다. 저장된 크기는 그대로
 * 그려진다. cellMinWidth 는 index.css 의 칸 최소 폭(min-w-16)과 같은 값이다.
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
    DocTableRow,
    TableCell.extend({ content: 'paragraph+' }),
    TableHeader.extend({ content: 'paragraph+' }),
  ]
}
