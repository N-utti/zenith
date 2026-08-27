import { Link, useParams } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { useDoc } from '@/features/docs/api'
import { DocWorkspace } from '@/features/docs/DocWorkspace'

export function DocEditorPage() {
  const { docId = '' } = useParams()
  const { data: meta, isPending, isError } = useDoc(docId)

  if (isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (isError || !meta) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-fg text-lg font-semibold">문서를 찾을 수 없습니다</h1>
        <Link to="/docs" className="text-accent mt-4 inline-block text-sm hover:underline">
          문서 목록으로 →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-line bg-surface flex h-11 shrink-0 items-center border-b px-3">
        <Link
          to="/docs"
          className="text-muted hover:text-fg flex items-center gap-1 text-sm transition-colors"
        >
          <ChevronLeft className="size-4" />
          문서
        </Link>
      </div>

      {/* docId가 바뀌면 협업 세션을 통째로 새로 연다. */}
      <DocWorkspace key={meta.id} meta={meta} />
    </div>
  )
}
