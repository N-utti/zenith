import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { hueOf } from '@/lib/avatar'
import { byTier, type Colleague } from './colleagues'

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

/**
 * 고를 사람들의 칩 묶음. 임원과 사원을 두 줄로 가른다(`byTier`).
 */
export function PersonChips({
  people,
  picked,
  onToggle,
}: {
  people: Colleague[]
  picked: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {byTier(people).map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex gap-2">
          <span aria-hidden className="text-subtle w-8 shrink-0 pt-1.5 text-xs">
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {group.people.map((each) => (
              <PersonChip
                key={each.id}
                person={each}
                picked={picked.includes(each.id)}
                onToggle={() => onToggle(each.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
