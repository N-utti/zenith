import { useEffect, useRef, useState, type ReactNode } from 'react'
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
 * 툴바용 팝오버. 바깥 클릭·Esc로 닫히고, 트리거를 눌러도 에디터 선택이 풀리지 않는다.
 * 내용은 열렸을 때만 마운트되므로 안에서 autoFocus를 써도 안전하다.
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
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 transition-colors',
          open ? 'bg-surface-hover text-fg' : 'text-muted hover:bg-surface-hover hover:text-fg',
        )}
      >
        {trigger}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'border-line bg-surface absolute top-full z-30 mt-1 rounded-xl border p-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
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
          {/* 라벨 길이에 따라 툴바 전체가 밀려 줄바꿈되지 않도록 폭을 고정한다.
              모바일에서는 이 80px 가 툴바 한 줄을 넘기므로 아이콘만 남긴다. */}
          <span className="hidden w-20 truncate text-left text-sm lg:block">{current.label}</span>
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
