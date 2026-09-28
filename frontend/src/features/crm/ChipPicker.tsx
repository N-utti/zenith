import { Avatar } from '@/components/ui/Avatar'
import type { FieldSlotProps } from '@/components/ui/Field'
import { hueOf } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import type { Person } from './types'

/**
 * 여러 명을 누름 단추로 고른다. 결재 참조자 고르기(`ApprovalNewPage`)와 같은 모양이다.
 * 사람이 열댓 명이라 검색 상자 없이 전부 늘어놓는 편이 빠르다.
 */
export function ChipPicker({
  slot,
  label,
  options,
  value,
  onChange,
  empty = '고를 사람이 없습니다.',
}: {
  slot: FieldSlotProps
  label: string
  options: Person[]
  value: string[]
  onChange: (ids: string[]) => void
  empty?: string
}) {
  return (
    <div
      id={slot.id}
      role="group"
      aria-label={label}
      aria-describedby={slot['aria-describedby']}
      className="flex flex-wrap gap-1.5"
    >
      {options.length === 0 && <p className="text-subtle text-sm">{empty}</p>}
      {options.map((each) => {
        const picked = value.includes(each.id)
        return (
          <button
            key={each.id}
            type="button"
            aria-pressed={picked}
            onClick={() =>
              onChange(picked ? value.filter((id) => id !== each.id) : [...value, each.id])
            }
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs transition-colors',
              picked
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-muted hover:bg-surface-hover',
            )}
          >
            <Avatar name={each.name} hue={hueOf(each.id)} size="sm" />
            {each.name}
          </button>
        )
      })}
    </div>
  )
}
