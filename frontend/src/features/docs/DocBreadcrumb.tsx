import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { useDocs } from './api'
import { pathTo } from './tree'

/**
 * 최상위부터 이 문서까지의 경로. 사이드바 트리와 같은 `parentId` 계층을 읽는다.
 *
 * 트리가 보이지 않는 좁은 화면에서는 이게 유일한 위치 표시라, `md` 미만에서는
 * 뒤로가기를 함께 둔다.
 */
export function DocBreadcrumb({ docId, title }: { docId: string; title: string }) {
  const { data } = useDocs('')
  const path = pathTo(docId, data?.items ?? [])
  const ancestors = path.slice(0, -1)

  return (
    <nav aria-label="문서 경로" className="flex min-w-0 items-center gap-1 text-xs">
      <Link
        to="/docs"
        aria-label="문서 목록으로"
        className="text-muted hover:text-fg -ml-1 flex shrink-0 items-center transition-colors md:hidden"
      >
        <ChevronLeft className="size-4" />
      </Link>

      {ancestors.map((doc) => (
        <span key={doc.id} className="hidden min-w-0 items-center gap-1 sm:flex">
          <Link
            to={`/docs/${doc.id}`}
            className="text-muted hover:text-fg max-w-40 truncate transition-colors"
          >
            {doc.title}
          </Link>
          <span className="text-subtle shrink-0">/</span>
        </span>
      ))}

      {/* 제목의 원천은 Y.Doc이라 목록 사본보다 이쪽이 먼저 최신이 된다. */}
      <span className="text-fg min-w-0 truncate font-medium">{title || '제목 없는 문서'}</span>
    </nav>
  )
}
