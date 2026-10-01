import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'

/**
 * 상세 화면 맨 위의 「목록으로」 링크. 화면마다 글자 화살표(←)와 아이콘이 섞여 있던 것을 한 모양으로 둔다.
 * 아이콘은 lucide 하나만 쓴다(12 UI 청사진 §3).
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-muted hover:text-fg mb-3 inline-flex items-center gap-1 text-sm transition-colors"
    >
      <ChevronLeft className="size-4" />
      {children}
    </Link>
  )
}
