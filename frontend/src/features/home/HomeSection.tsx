import type { ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * 홈 대시보드의 구획. 청사진에서 제목은 카드 안이 아니라 카드 위에 놓인다 —
 * 그래야 카드 하나짜리 구획과 그리드 구획이 같은 리듬으로 읽힌다.
 */
export function HomeSection({
  title,
  to,
  linkLabel = '전체 보기',
  children,
}: {
  title: string
  to?: string
  linkLabel?: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-fg text-sm font-bold">{title}</h2>
        {to && (
          <Link to={to} className="text-subtle hover:text-accent text-xs transition-colors">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
