import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('border-line bg-surface rounded-xl border', className)}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  count,
  to,
  linkLabel = '전체 보기',
}: {
  title: string
  count?: number
  to?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <h2 className="text-fg text-sm font-semibold">
        {title}
        {count !== undefined && count > 0 && (
          <span className="text-subtle ml-1.5 font-normal">{count}</span>
        )}
      </h2>
      {to && (
        <Link
          to={to}
          className="text-subtle hover:text-accent flex items-center gap-0.5 text-xs transition-colors"
        >
          {linkLabel}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="text-subtle px-5 py-8 text-center text-sm">{children}</p>
}
