import { MoveHorizontal } from 'lucide-react'
import type * as Y from 'yjs'
import { DOC_WIDTHS, useCollabWidth } from './collabState'
import { MenuItem, ToolMenu } from './editorControls'

/**
 * 본문 폭 고르기. 고른 값은 문서에 저장돼 같이 보는 사람에게도 같은 폭으로 보인다(`useCollabWidth`).
 * 화면이 본문보다 좁으면 어느 단계든 똑같이 보인다. 폭은 "여기까지 넓어져도 된다" 는 상한이다.
 */
export function DocWidthMenu({ doc }: { doc: Y.Doc }) {
  const { width, setWidth } = useCollabWidth(doc)

  return (
    <ToolMenu
      label="본문 폭"
      align="end"
      className="w-56"
      trigger={<MoveHorizontal className="size-4" />}
    >
      {(close) =>
        DOC_WIDTHS.map(({ value, label, hint }) => (
          <MenuItem
            key={value}
            label={label}
            hint={hint}
            active={value === width.value}
            onClick={() => {
              setWidth(value)
              close()
            }}
          />
        ))
      }
    </ToolMenu>
  )
}
