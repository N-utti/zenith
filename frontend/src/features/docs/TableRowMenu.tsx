import { useCallback, useEffect, useRef } from 'react'
import { isInTable, selectionCell } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/react'
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus'
import { TableMenu } from './editorControls'

/** 글 선택 막대(EditorBubbleMenu)와 따로 돈다. 키가 같으면 한쪽만 붙는다. */
const PLUGIN_KEY = 'tableRowMenu'

/** 표와 버튼 사이 틈. */
const GAP = 6

/**
 * 커서가 든 행의 오른쪽 끝에서 틈만큼 떨어진 자리. 표가 본문보다 넓어 가로로 구르고 있으면 보이는 쪽
 * 끝(tableWrapper)에 맞춘다. 안 그러면 버튼이 화면 밖으로 구른 표 끝을 따라가 사라진다.
 *
 * 틈을 offset 옵션으로 주지 않고 여기에 넣는다. 버블 메뉴는 offset 을 "스크롤 영역 안으로 밀기" 뒤에
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
 * 표 안에 커서가 있고 편집기를 떠나지 않았을 때만 띄운다. 떠난 뒤(제목·댓글 입력)에는 남의 편집이
 * 들어와도 다시 뜨면 안 된다. 이 버튼이나 이 버튼이 연 메뉴에 포커스가 있는 동안은 떠난 것이 아니다.
 */
const shouldShow: NonNullable<BubbleMenuProps['shouldShow']> = ({ editor, element, view, state }) =>
  editor.isEditable &&
  isInTable(state) &&
  (view.hasFocus() ||
    element.contains(document.activeElement) ||
    !!document.activeElement?.closest('[role="menu"]'))

// 아래 값들을 컴포넌트 안에서 만들면 다시 그릴 때마다 새 값이 되고, 버블 메뉴는 그때마다 편집기에
// 옵션 갱신 트랜잭션을 보낸다(제목을 한 글자 칠 때마다 하나씩).
const OPTIONS: BubbleMenuProps['options'] = {
  placement: 'right-start',
  offset: 0,
  // 오른쪽 여백이 모자라면 왼쪽으로 뒤집지 않고, 모자란 만큼만 표 끝에 걸친다(가로로만 민다).
  // 세로로는 밀지 않는다. 행이 화면 밖으로 구르면 버튼도 같이 나가야 한다.
  flip: false,
  shift: { mainAxis: false, crossAxis: true, padding: 4 },
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
  const appendTo = useCallback(() => anchorRef.current ?? document.body, [])
  const reference = useCallback(() => rowEnd(editor), [editor])

  // 포커스가 편집기·버튼·메뉴 밖으로 가면 숨긴다. 버블 메뉴가 스스로 숨기는 것만 믿으면 남는 때가 있다.
  // 버튼 위에서 누르면 "다음 blur 한 번은 숨기지 않는다" 는 표시가 켜지는데, 버튼을 다시 눌러 메뉴를
  // 닫을 때는 편집기에 포커스가 없어 blur 가 오지 않고, 그 표시가 다음 번(진짜로 떠날 때)에 쓰인다.
  useEffect(() => {
    const onFocusIn = ({ target }: FocusEvent) => {
      const anchor = anchorRef.current
      // 버튼이 떠 있을 때만 본다(뜨면 anchor 안에 붙는다).
      if (!anchor?.firstChild || !(target instanceof Element) || editor.isDestroyed) return
      const stays =
        editor.view.dom.contains(target) ||
        anchor.contains(target) ||
        target.closest('[role="menu"]')
      if (!stays) editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, 'hide'))
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [editor])

  return (
    <>
      <div ref={anchorRef} className="relative" />
      <BubbleMenu
        editor={editor}
        pluginKey={PLUGIN_KEY}
        updateDelay={0}
        appendTo={appendTo}
        shouldShow={shouldShow}
        getReferencedVirtualElement={reference}
        options={OPTIONS}
        className="border-line bg-surface z-10 rounded-lg border shadow-sm"
      >
        {/* 포인터만 올려도 열린다. 버튼이 작고 표 바로 옆이라 누르러 가는 길을 한 번 더 줄인다. */}
        <TableMenu editor={editor} inTable label="표 편집" hover />
      </BubbleMenu>
    </>
  )
}
