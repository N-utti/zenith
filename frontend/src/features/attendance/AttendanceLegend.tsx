import { cn } from '@/lib/cn'

/** 범례 견본(단색). `STATUS_TONE`(attendanceDays.ts)과 같은 계열이되 진하게 해서 작은 네모로도 구분된다. */
const LEGEND: Array<[label: string, solid: string]> = [
  ['휴가·반차', 'bg-accent'],
  ['재택·외근·출장', 'bg-info'],
  ['휴일', 'bg-line-strong'],
  ['결근', 'bg-danger'],
]

export function AttendanceLegend({ className }: { className?: string }) {
  return (
    <div className={cn('text-subtle flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)}>
      {LEGEND.map(([label, solid]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={cn('size-2.5 rounded-sm', solid)} />
          {label}
        </span>
      ))}
    </div>
  )
}
