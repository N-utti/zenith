import { Link, useLocation, useParams } from 'react-router'
import { Spinner } from '@/components/ui/Spinner'
import { useDoc } from '@/features/docs/api'
import { DocWorkspace } from '@/features/docs/DocWorkspace'
import type { DocSeedState } from '@/features/docs/types'

export function DocEditorPage() {
  const { docId = '' } = useParams()
  const { data: meta, isPending, isError } = useDoc(docId)
  // AI 답변 "문서로 저장"이 실어 보낸 초안. 문서가 비어 있는 첫 탭에서만 심긴다(DocWorkspace onCreate).
  const seed = useLocation().state as DocSeedState | null

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

  // 상단 경로 줄은 DocWorkspace가 그린다. 편집자 표시가 협업 세션을 필요로 해서다.
  // docId가 바뀌면 협업 세션을 통째로 새로 연다.
  return (
    <div className="flex h-full flex-col">
      <DocWorkspace key={meta.id} meta={seed?.seedHtml ? { ...meta, ...seed } : meta} />
    </div>
  )
}
