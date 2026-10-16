import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocusTrap } from '@/lib/useFocusTrap'

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

/**
 * 공용 모달. 청사진 §4.2가 "가장 먼저 만들어야 한다"고 지목한 부품이다.
 *
 * 여기서 세 가지를 한 번에 해결한다. 그동안 팔레트 한 곳에만 반쯤 들어 있던 것들이다.
 *   1. **포커스 트랩**. Tab이 모달 밖으로 나가지 않는다 (§8 미결이었다)
 *   2. **Esc 닫기**와 바깥 클릭 닫기
 *   3. **배경 스크롤 잠금**. 모달 뒤 본문이 따라 굴러가지 않는다
 *
 * ⌘K 팔레트는 상단 정렬·전체폭 입력 등 레이아웃이 달라 아직 자기 구현을 쓴다.
 * 팔레트를 이 부품으로 옮기는 건 별도 작업이다(§10).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  sheet,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** 제목 아래 한 줄 설명. 스크린리더에도 `aria-describedby`로 연결된다. */
  description?: string
  size?: Size
  /** 우측 정렬되는 액션 영역. 주 버튼을 오른쪽 끝에 둔다. */
  footer?: ReactNode
  /**
   * 폰(md 미만)에서 화면 아래에 붙는 시트로 연다. 엄지가 닿는 자리라 폰 캘린더의 날짜 창이 쓴다.
   * 끌어 내리기는 없다. 닫기는 바깥 누름·X·Esc 로 같다. 손잡이 막대를 그리면 끌 수 있는 줄 안다.
   */
  sheet?: boolean
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  useFocusTrap(open, panelRef, onClose)

  // 배경 스크롤 잠금. 모달 뒤 본문이 따라 굴러가지 않는다.
  useEffect(() => {
    if (!open) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        sheet && 'max-md:items-end max-md:p-0',
      )}
    >
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'border-line bg-surface relative flex max-h-full w-full flex-col rounded-xl border shadow-2xl outline-none',
          SIZES[size],
          sheet &&
            'max-md:max-h-[85dvh] max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-fg text-base font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-muted mt-1 text-sm">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-subtle hover:bg-surface-hover hover:text-fg -mt-1 -mr-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {footer && (
          <footer className="border-line flex items-center justify-end gap-2 border-t px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
