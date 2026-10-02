import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/** 화면 끝에서 띄울 틈. */
const EDGE = 8

/**
 * 포인터 자리에 뜨는 메뉴(우클릭). 부르는 쪽이 열 때 마운트한다.
 *
 * 항목을 고르거나, 바깥을 누르거나, Esc, 화면이 구르거나 창 크기가 바뀌면 닫힌다. 열리면 첫 항목으로
 * 초점을 옮기고 위아래 화살표로 오간다. 닫히면 초점을 열기 전 자리로 되돌린다. 키보드(Shift+F10,
 * 메뉴 키)로 열었을 때 이어서 쓸 수 있어야 한다.
 */
export function ContextMenu({
  at,
  label,
  onClose,
  children,
}: {
  /** 포인터의 화면 좌표. 메뉴가 화면 밖으로 나가면 안쪽으로 당긴다. */
  at: { x: number; y: number }
  /** 무엇의 메뉴인지. 스크린리더가 읽는다. */
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  // 자리는 그린 뒤에야 잴 수 있다(폭·높이를 알아야 화면 끝을 넘는지 안다). 페인트 전에 옮긴다.
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE))}px`
    menu.style.top = `${Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE))}px`
  }, [at.x, at.y])

  useLayoutEffect(() => {
    const opener = document.activeElement
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      // 고른 항목이 대화상자를 열었으면 초점은 그쪽이 가져간다(이 뒤에 실행된다).
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    const menu = ref.current
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && menu?.contains(target))

    const onPointerDown = (e: PointerEvent) => {
      if (outside(e.target)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') return onClose()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      const i = items.findIndex((item) => item === document.activeElement)
      const next =
        e.key === 'ArrowDown' ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1
      items[next]?.focus()
    }
    const onScroll = (e: Event) => {
      if (outside(e.target)) onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 잡아 둔 자리는 화면이 움직이면 가리키던 줄에서 떨어진다. 따라다니게 하는 것보다 닫는 쪽이 싸다.
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left: at.x, top: at.y }}
      // 항목을 고르면 닫는다. 항목의 동작이 먼저 돌고 여기로 올라온다.
      onClick={onClose}
      // 메뉴 위에서 다시 우클릭해도 브라우저 메뉴가 겹쳐 뜨지 않게 한다.
      onContextMenu={(e) => e.preventDefault()}
      className="border-line bg-surface fixed z-50 w-52 max-w-[calc(100vw-1rem)] rounded-xl border p-1 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  )
}

export function ContextMenuItem({
  icon: Icon,
  label,
  danger,
  onSelect,
}: {
  icon: LucideIcon
  label: string
  /** 지우기처럼 되돌리기 어려운 동작. 붉게 보인다. */
  danger?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'hover:bg-surface-hover focus-visible:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}
