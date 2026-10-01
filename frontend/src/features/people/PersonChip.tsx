import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { hueOf } from '@/lib/avatar'

/** 사람을 여럿 고르는 자리의 알약 하나(결재 참조자·비공개 채널 멤버). 눌러서 넣고 뺀다. */
export function PersonChip({
  person,
  picked,
  onToggle,
}: {
  person: { id: string; name: string }
  picked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onToggle}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs transition-colors',
        picked
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-muted hover:bg-surface-hover',
      )}
    >
      <Avatar name={person.name} hue={hueOf(person.id)} size="sm" />
      {person.name}
    </button>
  )
}
