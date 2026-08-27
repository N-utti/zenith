import type { LucideIcon } from 'lucide-react'

/**
 * 아직 구현하지 않은 모듈 자리. 로드맵상 무엇이 들어올 자리인지 명시해
 * 빈 화면이 "버그"가 아니라 "다음 작업"으로 읽히게 한다.
 */
export function PlaceholderPanel({
  icon: Icon,
  milestone,
  items,
}: {
  icon: LucideIcon
  milestone: string
  items: string[]
}) {
  return (
    <div className="border-line bg-surface rounded-xl border border-dashed p-8">
      <div className="flex items-start gap-4">
        <span className="bg-accent-soft text-accent grid size-10 shrink-0 place-items-center rounded-lg">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-fg text-sm font-medium">{milestone} 에서 구현 예정</p>
          <ul className="text-muted mt-3 space-y-1.5 text-sm">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-subtle">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
