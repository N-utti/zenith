import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      className={cn(
        'border-line border-t-accent inline-block size-4 animate-spin rounded-full border-2',
        className,
      )}
    />
  )
}
