import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight, RefreshCw } from 'lucide-react'
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

/**
 * `onRetry` 를 주면 오류 표시가 된다. danger 톤 문구 + 다시 시도(12 §5 오류 규약).
 * `action` 은 빈 목록에서의 주 행동 버튼(12 §5 "빈 목록: 안내 문구 + 주 행동 버튼"). 오류 표시에는 안 쓴다.
 */
export function CardEmpty({
  children,
  onRetry,
  action,
}: {
  children: ReactNode
  onRetry?: () => Promise<unknown>
  action?: ReactNode
}) {
  if (!onRetry) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-8 text-center text-sm">
        <p className="text-subtle">{children}</p>
        {action}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-8 text-sm">
      <p className="text-danger text-center">{children}</p>
      <RetryButton onClick={onRetry} />
    </div>
  )
}

/**
 * 누르면 요청이 끝날 때까지 스스로 잠근다. 실패한 쿼리는 재조회 중에도 `isError` 가 그대로라
 * 화면만 보면 눌렸는지 알 수 없고, queryClient 의 자동 재시도 때문에 몇 초 걸린다.
 */
export function RetryButton({ onClick }: { onClick: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void onClick().finally(() => setBusy(false))
      }}
      className="text-subtle hover:text-fg flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:cursor-default disabled:opacity-60"
    >
      <RefreshCw className={cn('size-3', busy && 'animate-spin')} />
      다시 시도
    </button>
  )
}
