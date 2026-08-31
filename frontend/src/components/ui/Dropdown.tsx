import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface DropdownOption {
  value: string
  label: string
  /** 라벨 아래 한 줄 설명. 없으면 표시하지 않는다. */
  note?: string
  /** 고를 수 없는 항목. 목록에서 지우지 않고 흐리게 남긴다. */
  disabled?: boolean
  /** disabled일 때 왜 못 고르는지. `title`로 붙는다. */
  disabledReason?: string
}

/**
 * 값 하나를 고르는 작은 드롭다운. `UserMenu`의 특화 구현을 일반화한 것으로,
 * 모델 선택·지식 소스 선택처럼 "버튼에 현재 값이 보이는" 자리에 쓴다.
 *
 * 포커스 트랩은 없다 — 공용 `Modal`이 생길 때 그쪽 규약을 따라간다.
 */
export function Dropdown({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  /** 버튼 앞에 붙는 고정 문구. "모델:" 처럼 무엇을 고르는지 밝힌다. */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
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
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-line text-muted hover:border-line-strong hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors"
      >
        {/* 라벨은 보조 정보다. 좁은 화면에서는 값만 남긴다. */}
        {label && <span className="text-subtle hidden sm:inline">{label}</span>}
        <span className="truncate">{current?.label ?? '선택'}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="border-line bg-surface absolute bottom-full left-0 z-40 mb-1.5 w-56 rounded-xl border p-1.5 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              title={option.disabled ? option.disabledReason : undefined}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                option.disabled
                  ? 'text-subtle cursor-not-allowed opacity-55'
                  : 'text-fg hover:bg-surface-hover cursor-pointer',
              )}
            >
              <Check
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  option.value === value ? 'text-accent' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.note && <span className="text-subtle block text-[11px]">{option.note}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
