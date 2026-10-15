import type { PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/cn'
import type { usePanelWidth } from '@/lib/usePanelWidth'

const STEP = 16

/**
 * 패널 가장자리의 폭 조절 손잡이. 패널 바로 옆에 형제로 둔다. 음수 여백으로 경계선 오른쪽 칸 위에 겹친다.
 * 경계 왼쪽 칸에는 세로 스크롤바가 붙어 있어(Windows 는 자리를 차지한다) 그쪽으로는 내밀지 않는다.
 * side 는 손잡이가 패널의 어느 쪽 가장자리에 있는지다(왼쪽 패널은 right, 오른쪽 패널은 left).
 * 화살표 키로도 조절하고, 두 번 누르면 처음 폭으로 돌아간다.
 */
export function ResizeHandle({
  panel,
  side,
  label,
  className,
}: {
  panel: ReturnType<typeof usePanelWidth>
  side: 'left' | 'right'
  label: string
  className?: string
}) {
  const dir = side === 'right' ? 1 : -1

  const start = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    // 저장값이 아니라 지금 그려진 폭에서 시작한다. 좁은 창에서는 maxWidth 로 저장값보다 좁게 그려진다.
    const box =
      side === 'right'
        ? event.currentTarget.previousElementSibling
        : event.currentTarget.nextElementSibling
    const startWidth = box?.getBoundingClientRect().width ?? panel.width
    // 끄는 동안 글자 선택·전환 애니메이션을 끄고 커서를 유지한다(index.css 의 data-resizing).
    const root = document.documentElement
    root.dataset.resizing = ''

    const onMove = (move: PointerEvent) => {
      // 창 밖에서 버튼을 놓으면 pointerup 이 안 올 수 있다. 버튼이 풀린 채 움직이면 끝낸다.
      if (!(move.buttons & 1)) return onUp()
      panel.set(startWidth + (move.clientX - startX) * dir)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      delete root.dataset.resizing
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      aria-valuetext={`${panel.width}픽셀`}
      tabIndex={0}
      title="끌어서 폭 조절, 두 번 누르면 원래대로"
      onPointerDown={start}
      onDoubleClick={panel.reset}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? STEP : event.key === 'ArrowLeft' ? -STEP : 0
        if (!step) return
        event.preventDefault()
        panel.set(panel.width + step * dir)
      }}
      className={cn(
        'group relative z-10 -mr-2 w-2 shrink-0 cursor-col-resize touch-none outline-none',
        className,
      )}
    >
      <span className="group-hover:bg-accent/60 group-focus-visible:bg-accent absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 transition-colors" />
    </div>
  )
}
