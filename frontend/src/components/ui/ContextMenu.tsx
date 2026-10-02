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
    const menu = ref.current
    const opener = document.activeElement
    menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      // 초점이 아직 메뉴에 있을 때만 되돌린다. 이미 다른 데(검색 창 등)로 갔으면 뺏지 않는다.
      // 고른 항목이 대화상자를 열었으면 초점은 그쪽이 가져간다(이 뒤에 실행된다).
      if (menu?.contains(document.activeElement) && opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  useEffect(() => {
    const menu = ref.current
    if (!menu) return
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && menu.contains(target))
    // 메뉴가 뜬 자리 밑에 있던 것(우클릭한 줄). 이것을 품은 영역이 구를 때만 닫는다.
    const under = document.elementsFromPoint(at.x, at.y).find((el) => !menu.contains(el))

    const onPointerDown = (e: PointerEvent) => {
      if (outside(e.target)) onClose()
    }
    // 초점이 메뉴 밖으로 가면(⌘K 검색 등) 닫는다. 열린 채 남으면 화살표·Enter 를 두 곳이 같이 받는다.
    // 이벤트의 대상이 아니라 한 박자 뒤의 초점 자리로 판정한다. 개발 모드는 이펙트를 한 번 더 돌려
    // 보는데, 그 정리 단계에서 초점이 연 자리로 갔다가 곧바로 메뉴로 돌아온다. 그 잠깐은 떠난 것이 아니다.
    const onFocusIn = () =>
      queueMicrotask(() => {
        if (menu.isConnected && outside(document.activeElement)) onClose()
      })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 메뉴만 닫는다. 뒤에 열린 서랍·대화상자까지 같은 Esc 로 닫히지 않게 여기서 멈춘다.
        e.stopPropagation()
        return onClose()
      }
      if (e.key === 'Tab') return onClose()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      const i = items.findIndex((item) => item === document.activeElement)
      const next =
        e.key === 'ArrowDown' ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1
      items[next]?.focus()
    }
    const onScroll = (e: Event) => {
      // 잡아 둔 자리는 그 줄이 구르면 줄에서 떨어진다. 따라다니게 하는 것보다 닫는 쪽이 싸다.
      // 상관없는 영역(답변이 흘러나오는 AI 대화, 새 메시지가 온 채팅)이 구르는 것은 무시한다.
      if (under && e.target instanceof Node && e.target.contains(under)) onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    // 캡처로 듣는다. 다른 Esc 처리기(서랍·대화상자)보다 먼저 받아야 멈출 수 있다.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, at.x, at.y])

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
  disabledReason,
  onSelect,
}: {
  icon: LucideIcon
  label: string
  /** 지우기처럼 되돌리기 어려운 동작. 붉게 보인다. */
  danger?: boolean
  /**
   * 지금은 할 수 없는 이유. 주면 항목이 흐려지고 그 아래에 이유가 적힌다. 목록에서 빼지 않는
   * 것은, 빼면 그 기능이 있는지조차 알 수 없어서다.
   */
  disabledReason?: string
  onSelect: () => void
}) {
  const disabled = disabledReason !== undefined
  return (
    <button
      type="button"
      role="menuitem"
      // `disabled` 속성은 쓰지 않는다. 초점을 못 받게 되어 화살표로 지나갈 때 건너뛰고,
      // 낭독기는 이유를 읽지 못한다. 눌러도 아무 일이 없고 메뉴도 닫히지 않게만 한다.
      aria-disabled={disabled || undefined}
      onClick={(e) => (disabled ? e.stopPropagation() : onSelect())}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
        disabled
          ? 'text-subtle cursor-not-allowed'
          : cn('hover:bg-surface-hover cursor-pointer', danger ? 'text-danger' : 'text-fg'),
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {disabledReason && <span className="mt-0.5 block text-xs">{disabledReason}</span>}
      </span>
    </button>
  )
}
