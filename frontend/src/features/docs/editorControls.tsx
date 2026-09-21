import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Check, ChevronDown, Link2, Link2Off } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BLOCK_BY_KEY, EDITOR_BLOCKS } from './editorBlocks'
import { ALIGNMENTS, HIGHLIGHT_COLORS, TEXT_COLORS } from './editorFormats'

/* ── 공통 버튼 ──────────────────────────────────────────────── */

export function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  spinning,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  /** 진행 중 표시. 아이콘을 돌린다. */
  spinning?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // 에디터가 포커스를 잃으면 선택 영역이 사라져 서식이 엉뚱한 곳에 걸린다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon className={cn('size-4', spinning && 'animate-spin')} />
    </button>
  )
}

export function ToolDivider() {
  return <span className="bg-line mx-1 h-5 w-px shrink-0" />
}

/* ── 드롭다운 ───────────────────────────────────────────────── */

/**
 * 팝오버를 띄울 자리. 트리거 바로 아래, 화면 밖으로는 나가지 않게.
 *
 * 아래가 모자라면 위로 뒤집고, 그래도 모자라면 남은 높이만큼만 쓰고 안에서 구른다.
 * 가로 모드 휴대폰은 세로가 360px 남짓이라 항목 여덟 개짜리 블록 메뉴가 잘린다.
 *
 * `InlineAiPopover` 의 `anchorAt` 도 같은 일을 한다. 그쪽은 DOM 이 아니라 편집기 커서 좌표를
 * 받고 폭이 고정이라 지금 합치려면 양쪽 호출부를 다 고쳐야 해서 두 벌로 둔다.
 */
function menuPosition(trigger: DOMRect, menu: DOMRect, align: 'start' | 'end') {
  const GAP = 4
  const EDGE = 8
  // innerWidth 는 스크롤바를 포함한다. 여백 계산에는 내용 폭을 쓴다.
  const { clientWidth: vw, clientHeight: vh } = document.documentElement

  const below = vh - trigger.bottom - GAP - EDGE
  const above = trigger.top - GAP - EDGE
  const flip = menu.height > below && above > below
  const wanted = align === 'end' ? trigger.right - menu.width : trigger.left

  return {
    top: flip ? Math.max(EDGE, trigger.top - GAP - menu.height) : trigger.bottom + GAP,
    left: Math.max(EDGE, Math.min(wanted, vw - menu.width - EDGE)),
    maxHeight: Math.max(flip ? above : below, 120),
  }
}

/**
 * 툴바용 팝오버. 바깥 클릭·Esc로 닫히고, 트리거를 눌러도 에디터 선택이 풀리지 않는다.
 * 내용은 열렸을 때만 마운트되므로 안에서 autoFocus를 써도 안전하다.
 *
 * **body 로 내보내 띄운다.** 툴바 안에 두면 툴바의 `overflow-x-auto`(좁은 화면에서 서식을
 * 가로로 굴리는 그것)가 세로 방향까지 잘라 메뉴가 통째로 사라진다. `position: fixed` 로는
 * 못 피한다. 툴바에 `backdrop-blur` 가 걸려 있고 `backdrop-filter` 는 자기 자신을 fixed 의
 * 기준 상자로 만들기 때문이다. 자리는 열 때 트리거 위치를 재서 잡고, 화면이 움직이면
 * (스크롤·리사이즈) 어긋나므로 닫는다.
 */
export function ToolMenu({
  label,
  trigger,
  align = 'start',
  className,
  children,
}: {
  label: string
  trigger: ReactNode
  align?: 'start' | 'end'
  className?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState<ReturnType<typeof menuPosition> | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  /** 닫고 포커스를 트리거로 되돌린다. 키보드로 들어왔으면 되돌려 줘야 이어서 쓸 수 있다. */
  const close = (focusTrigger = false) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  // 자리는 메뉴를 그린 뒤에야 잴 수 있다(폭·높이를 알아야 화면 끝을 넘는지 판정한다).
  // 페인트 전에 옮겨야 첫 프레임이 엉뚱한 자리에 번쩍이지 않는다.
  useLayoutEffect(() => {
    if (!open) return
    const button = triggerRef.current
    const menu = menuRef.current
    if (!button || !menu) return
    setSpot(menuPosition(button.getBoundingClientRect(), menu.getBoundingClientRect(), align))
    // 포털로 나간 메뉴는 트리거의 다음 형제가 아니라서 Tab 으로 들어갈 수 없다. 열면서
    // 첫 항목으로 옮겨 준다. 입력칸이 있는 메뉴(링크)는 그쪽 autoFocus 가 이미 가져갔으므로
    // 뺏지 않는다.
    if (!menu.contains(document.activeElement)) {
      menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return

    const inside = (target: EventTarget | null) =>
      triggerRef.current?.contains(target as globalThis.Node) ||
      menuRef.current?.contains(target as globalThis.Node)

    const onPointerDown = (e: PointerEvent) => {
      // 메뉴는 이제 툴바 바깥(body)에 있다. 둘 다 봐야 메뉴 안을 눌러도 안 닫힌다.
      if (!inside(e.target)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    const onFocusOut = (e: FocusEvent) => {
      // Tab 으로 메뉴 밖으로 나가면 닫는다. 메뉴는 body 끝에 있어서 마지막 항목에서 Tab 을
      // 누르면 갈 곳이 없고(relatedTarget 이 비어 온다), 그때도 닫아야 열린 채로 안 남는다.
      if (!inside(e.relatedTarget)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      // 메뉴가 제 안에서 구르는 것(긴 목록, 링크 입력칸의 가로 스크롤)까지 닫으면,
      // 주소를 몇 자 치자마자 메뉴가 사라진다.
      if (!menuRef.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onResize = () => setOpen(false)

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusout', onFocusOut)
    // 트리거가 움직이면 잡아 둔 자리가 틀어진다. 따라다니게 만드는 것보다 닫는 쪽이 싸다.
    window.addEventListener('resize', onResize)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // 열 때 지난번 자리를 지운다. 안 지우면 다시 열리는 첫 프레임에 이전 자리로
          // 한 번 번쩍인 뒤 제자리를 찾는다. 트리거가 툴바 가로 스크롤을 따라 움직인다.
          if (!open) setSpot(null)
          setOpen(!open)
        }}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 transition-colors',
          open ? 'bg-surface-hover text-fg' : 'text-muted hover:bg-surface-hover hover:text-fg',
        )}
      >
        {trigger}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={spot ?? undefined}
            className={cn(
              'border-line bg-surface fixed z-50 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border p-1 shadow-lg',
              // 자리를 재기 전 한 프레임은 숨긴다. 안 그러면 왼쪽 위에서 제자리로 튄다.
              // visibility 가 아니라 opacity 로 숨긴다. visibility:hidden 인 요소는 포커스를
              // 받지 못해서, 그 한 프레임에 거는 첫 항목 포커스가 통째로 무시된다.
              spot ? 'opacity-100' : 'pointer-events-none opacity-0',
              className,
            )}
          >
            {/* 항목을 고른 뒤에는 포커스를 되돌리지 않는다. 블록·색·정렬은 실행하면서
                편집기로 포커스를 가져가는데, 여기서 트리거로 뺏으면 이어서 타이핑을 못 한다. */}
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function MenuItem({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-hover',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-70" />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-subtle shrink-0 text-xs">{hint}</span>}
      {active && <Check className="text-accent size-3.5 shrink-0" />}
    </button>
  )
}

/* ── 블록 종류 · 정렬 ───────────────────────────────────────── */

/** 서식을 바꿀 수 있는 블록만. 구분선처럼 삽입 전용인 항목은 빠진다. */
const CONVERTIBLE_BLOCKS = EDITOR_BLOCKS.filter((block) => block.isActive)

export function BlockMenu({ editor, blockKey }: { editor: Editor; blockKey: string }) {
  const current = BLOCK_BY_KEY[blockKey] ?? CONVERTIBLE_BLOCKS[0]

  return (
    <ToolMenu
      label="블록 종류"
      className="w-52"
      trigger={
        <span className="flex items-center gap-1.5">
          <current.icon className="size-4" />
          {/* 고른 블록 이름이 길어도 트리거 폭이 들썩이지 않게 고정한다. */}
          <span className="w-20 truncate text-left text-sm">{current.label}</span>
        </span>
      }
    >
      {(close) =>
        CONVERTIBLE_BLOCKS.map((block) => (
          <MenuItem
            key={block.key}
            icon={block.icon}
            label={block.label}
            active={block.key === blockKey}
            onClick={() => {
              block.run(editor)
              close()
            }}
          />
        ))
      }
    </ToolMenu>
  )
}

export function AlignMenu({ editor, align }: { editor: Editor; align: string }) {
  const current = ALIGNMENTS.find(({ value }) => value === align) ?? ALIGNMENTS[0]

  return (
    <ToolMenu label="정렬" className="w-40" trigger={<current.icon className="size-4" />}>
      {(close) =>
        ALIGNMENTS.map((option) => (
          <MenuItem
            key={option.value}
            icon={option.icon}
            label={option.label}
            active={option.value === align}
            onClick={() => {
              editor.chain().focus().setTextAlign(option.value).run()
              close()
            }}
          />
        ))
      }
    </ToolMenu>
  )
}

/* ── 색상 ───────────────────────────────────────────────────── */

function Swatch({
  label,
  color,
  ring,
  active,
  onClick,
}: {
  label: string
  color: string
  ring?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-7 cursor-pointer place-items-center rounded-md transition-transform hover:scale-110',
        active && 'ring-accent ring-2 ring-offset-1 ring-offset-[var(--color-surface)]',
      )}
    >
      <span
        className={cn('size-5 rounded', ring && 'border-line border')}
        style={{ backgroundColor: color }}
      />
    </button>
  )
}

/** 글자색·형광펜을 한 팝오버에서 고른다. */
export function ColorMenu({
  editor,
  color,
  highlight,
}: {
  editor: Editor
  color: string | null
  highlight: string | null
}) {
  return (
    <ToolMenu
      label="글자색 · 형광펜"
      className="w-56"
      trigger={
        <span className="grid size-5 place-items-center">
          <span
            className="text-[13px] leading-none font-semibold"
            style={{ color: color ?? undefined }}
          >
            A
          </span>
          <span
            className="mt-0.5 h-1 w-4 rounded-full"
            style={{ backgroundColor: highlight ?? color ?? 'var(--color-line-strong)' }}
          />
        </span>
      }
    >
      {(close) => (
        <div className="p-1">
          <p className="text-subtle px-1 pb-1.5 text-xs font-medium">글자색</p>
          <div className="grid grid-cols-6 gap-1">
            <Swatch
              label="기본"
              color="var(--color-fg)"
              active={!color}
              onClick={() => {
                editor.chain().focus().unsetColor().run()
                close()
              }}
            />
            {TEXT_COLORS.map((c) => (
              <Swatch
                key={c.value}
                label={c.label}
                color={c.value}
                active={color === c.value}
                onClick={() => {
                  editor.chain().focus().setColor(c.value).run()
                  close()
                }}
              />
            ))}
          </div>

          <p className="text-subtle px-1 pt-3 pb-1.5 text-xs font-medium">형광펜</p>
          <div className="grid grid-cols-6 gap-1">
            <Swatch
              label="없음"
              color="transparent"
              ring
              active={!highlight}
              onClick={() => {
                editor.chain().focus().unsetHighlight().run()
                close()
              }}
            />
            {HIGHLIGHT_COLORS.map((c) => (
              <Swatch
                key={c.value}
                label={c.label}
                color={c.value}
                active={highlight === c.value}
                onClick={() => {
                  editor.chain().focus().setHighlight({ color: c.value }).run()
                  close()
                }}
              />
            ))}
          </div>
        </div>
      )}
    </ToolMenu>
  )
}

/* ── 링크 ───────────────────────────────────────────────────── */

/** 스킴이 없으면 https를 붙인다. javascript: 같은 위험한 스킴은 Link 확장이 다시 거른다. */
function normalizeHref(raw: string) {
  const value = raw.trim()
  if (!value) return null
  if (/^(https?|mailto|tel):/i.test(value)) return value
  if (value.includes('@') && !value.includes('/')) return `mailto:${value}`
  return `https://${value}`
}

export function LinkMenu({ editor, href }: { editor: Editor; href: string | null }) {
  return (
    <ToolMenu
      label="링크"
      align="end"
      className="w-72"
      trigger={<Link2 className={cn('size-4', href && 'text-accent')} />}
    >
      {(close) => (
        <LinkForm
          initial={href ?? ''}
          onSubmit={(value) => {
            const url = normalizeHref(value)
            if (url) {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            }
            close()
          }}
          onRemove={
            href
              ? () => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  close()
                }
              : undefined
          }
        />
      )}
    </ToolMenu>
  )
}

function LinkForm({
  initial,
  onSubmit,
  onRemove,
}: {
  initial: string
  onSubmit: (value: string) => void
  onRemove?: () => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <div className="flex items-center gap-1 p-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(value)
          }
        }}
        placeholder="https://example.com"
        aria-label="링크 주소"
        className="bg-sunken text-fg placeholder:text-subtle min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none"
      />
      {onRemove && <ToolButton icon={Link2Off} label="링크 제거" onClick={onRemove} />}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSubmit(value)}
        className="bg-accent text-on-accent hover:bg-accent-hover shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
      >
        적용
      </button>
    </div>
  )
}
