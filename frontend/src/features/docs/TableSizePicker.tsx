import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

const MAX_ROWS = 8
const MAX_COLS = 8

const ARROWS: Record<string, [rows: number, cols: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/**
 * 넣을 표의 크기를 고르는 격자. 포인터가 지나가는 칸까지가 칠해지고, 누르면 그 크기로 넣는다
 * (한글·워드와 같은 방식). 키보드로는 방향키로 크기를 바꾸고 Enter 로 넣는다.
 *
 * 칸마다 `menuitem` 이라 ToolMenu 가 열릴 때 첫 칸(1x1)에 포커스를 준다. Tab 으로는 지금 고른
 * 칸 하나만 거친다. 64칸을 다 거치게 두면 메뉴를 빠져나가는 데 Tab 을 64번 눌러야 한다.
 */
export function TableSizePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [size, setSize] = useState({ rows: 1, cols: 1 })
  const gridRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent) => {
    const step = ARROWS[e.key]
    if (!step) return
    e.preventDefault()
    const rows = Math.min(MAX_ROWS, Math.max(1, size.rows + step[0]))
    const cols = Math.min(MAX_COLS, Math.max(1, size.cols + step[1]))
    // 포커스를 옮기면 그 칸의 onFocus 가 크기를 바꾼다.
    gridRef.current?.querySelector<HTMLElement>(`[data-size="${rows}x${cols}"]`)?.focus()
  }

  return (
    <div className="p-1">
      <p className="text-subtle px-0.5 pb-1.5 text-xs font-medium">
        표 넣기 · {size.rows}행 {size.cols}열
      </p>
      <div
        ref={gridRef}
        onKeyDown={onKeyDown}
        className="grid w-fit gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
          const rows = Math.floor(i / MAX_COLS) + 1
          const cols = (i % MAX_COLS) + 1
          const picked = rows === size.rows && cols === size.cols
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              data-size={`${rows}x${cols}`}
              aria-label={`${rows}행 ${cols}열 표 넣기`}
              tabIndex={picked ? 0 : -1}
              // 편집기가 포커스를 잃으면 커서 자리가 사라져 표가 엉뚱한 곳에 들어간다.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSize({ rows, cols })}
              onFocus={() => setSize({ rows, cols })}
              onClick={() => onPick(rows, cols)}
              className={cn(
                'size-[18px] cursor-pointer rounded-[3px] border transition-colors',
                rows <= size.rows && cols <= size.cols
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-surface',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
