import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { UNTITLED_DOC, useTree } from './api'
import { foldersTo } from './tree'

/**
 * 최상위부터 이 문서까지의 경로. 사이드바 트리와 같은 폴더 계층을 읽는다.
 *
 * 조상은 폴더뿐이라 누를 수 없다. 폴더에는 열 화면이 없다(문서 목록은 폴더로 나뉘지 않는다).
 *
 * 트리가 보이지 않는 좁은 화면에서는 이게 유일한 위치 표시라, `md` 미만에서는
 * 뒤로가기를 함께 둔다.
 */
export function DocBreadcrumb({ docId, title }: { docId: string; title: string }) {
  const { data } = useTree()
  const ancestors = foldersTo(docId, data ?? { folders: [], docs: [] })

  return (
    <nav aria-label="문서 경로" className="flex min-w-0 items-center gap-1 text-xs">
      <Link
        to="/docs"
        aria-label="문서 목록으로"
        className="text-muted hover:text-fg -ml-1 flex shrink-0 items-center transition-colors md:hidden"
      >
        <ChevronLeft className="size-4" />
      </Link>

      {ancestors.map((folder) => (
        <span key={folder.id} className="hidden min-w-0 items-center gap-1 sm:flex">
          <span className="text-muted max-w-40 truncate">{folder.title}</span>
          <span className="text-subtle shrink-0">/</span>
        </span>
      ))}

      {/* 제목의 원천은 Y.Doc이라 목록 사본보다 이쪽이 먼저 최신이 된다. */}
      <span className="text-fg min-w-0 truncate font-medium">{title || UNTITLED_DOC}</span>
    </nav>
  )
}
