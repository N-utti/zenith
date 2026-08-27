import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-sunken animate-pulse rounded', className)} />
}

/** 목록형 카드의 로딩 자리. 실제 행 높이와 맞춰 레이아웃이 튀지 않게 한다. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-5 py-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}
