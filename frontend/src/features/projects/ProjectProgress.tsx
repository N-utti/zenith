import type { Project } from './types'

/** 완료한 업무의 비율. 목록 카드와 보드 머리가 같이 쓴다. */
export function ProjectProgress({
  project,
}: {
  project: Pick<Project, 'task_count' | 'done_count'>
}) {
  const { task_count: total, done_count: done } = project
  if (total === 0) return <p className="text-subtle text-xs">업무 없음</p>
  return (
    <div className="flex items-center gap-2">
      <progress
        value={done}
        max={total}
        aria-label="완료한 업무"
        className="[&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent bg-sunken h-1.5 min-w-0 flex-1 appearance-none overflow-hidden rounded-full border-0"
      />
      <span className="text-muted text-xs whitespace-nowrap tabular-nums">
        {done}/{total} 완료
      </span>
    </div>
  )
}
