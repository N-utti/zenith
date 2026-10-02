import { useRef } from 'react'
import { isInTable, selectionCell } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { TableMenu } from './editorControls'

/** 표와 버튼 사이 틈. */
const GAP = 6

/**
 * 커서가 든 행의 오른쪽 끝에서 틈만큼 떨어진 자리. 표가 본문보다 넓어 가로로 구르고 있으면 보이는 쪽
 * 끝(tableWrapper)에 맞춘다. 안 그러면 버튼이 화면 밖으로 구른 표 끝을 따라가 사라진다.
 *
 * 틈을 offset 옵션으로 주지 않고 여기에 넣는다. 버블 메뉴는 offset 을 «스크롤 영역 안으로 밀기» 뒤에
 * 적용해서, 좁은 화면에서 안으로 민 버튼을 틈만큼 다시 밖으로 내보낸다(가로 스크롤바가 생긴다).
 */
function rowEnd(editor: Editor) {
  if (!isInTable(editor.state)) return null
  // 칸 바로 앞 자리. 그 자리의 부모가 행이다.
  const row = editor.view.nodeDOM(selectionCell(editor.state).before())
  if (!(row instanceof HTMLElement)) return null
  const wrapper = row.closest('.tableWrapper')

  return {
    getBoundingClientRect: () => {
      const rect = row.getBoundingClientRect()
      const right = Math.min(rect.right, wrapper?.getBoundingClientRect().right ?? rect.right)
      return new DOMRect(right + GAP, rect.top, 0, rect.height)
    },
  }
}

/**
 * 표 안에 커서가 있는 동안 그 행 옆에 떠 있는 표 버튼. 서식 툴바의 표 메뉴와 같은 메뉴를 연다.
 * 행·열을 여러 번 더할 때 툴바까지 오가지 않게 하는 지름길이다(노션의 행 손잡이 메뉴와 같은 역할).
 *
 * 표의 오른쪽 바깥에 둔다. 왼쪽 바깥은 블록 손잡이 자리라 첫 행에서 겹치고, 칸 안에 두면 글을 가린다.
 */
export function TableRowMenu({ editor }: { editor: Editor }) {
  /**
   * 버튼을 붙일 자리. 기본 자리(편집기의 부모)에 붙이면 버튼의 기준 상자가 body 가 되어, 본문을 굴려도
   * 버튼은 제자리에 남고 좁은 화면에서는 옆 댓글 패널 위로 넘어간다. 본문과 같이 구르는 이 자리를
   * 기준으로 삼으면 행을 따라 구르고, 스크롤 영역 밖으로 나가지 않는다.
   */
  const anchorRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div ref={anchorRef} className="relative" />
      <BubbleMenu
        editor={editor}
        // 글 선택 막대(EditorBubbleMenu)와 따로 돈다. 키가 같으면 한쪽만 붙는다.
        pluginKey="tableRowMenu"
        updateDelay={0}
        appendTo={() => anchorRef.current ?? document.body}
        shouldShow={({ editor: e, view, state }) =>
          e.isEditable &&
          isInTable(state) &&
          // 편집기를 떠나면(제목·댓글 입력) 숨긴다. 남의 편집이 들어올 때마다 다시 뜨면 안 된다.
          // 이 버튼이 연 메뉴에 포커스가 가 있는 동안은 떠난 것이 아니다.
          (view.hasFocus() || !!document.activeElement?.closest('[role="menu"]'))
        }
        getReferencedVirtualElement={() => rowEnd(editor)}
        options={{
          placement: 'right-start',
          offset: 0,
          // 오른쪽 여백이 모자라면 왼쪽으로 뒤집지 않고, 모자란 만큼만 표 끝에 걸친다(가로로만 민다).
          // 세로로는 밀지 않는다. 행이 화면 밖으로 구르면 버튼도 같이 나가야 한다.
          flip: false,
          shift: { mainAxis: false, crossAxis: true, padding: 4 },
        }}
        className="border-line bg-surface z-10 rounded-lg border shadow-sm"
      >
        <TableMenu editor={editor} inTable label="표 편집" />
      </BubbleMenu>
    </>
  )
}
