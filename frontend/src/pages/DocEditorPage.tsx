import { useLocation, useParams } from 'react-router'
import { DocPane } from '@/features/docs/DocPane'
import type { DocSeedState } from '@/features/docs/types'

/** 문서 편집 화면. 화면을 나눠 오른쪽에 띄우는 문서는 AppLayout 이 맡는다(어느 화면에서나 뜨게). */
export function DocEditorPage() {
  const { docId = '' } = useParams()
  // AI 답변 "문서로 저장"이 실어 보낸 초안.
  const seed = useLocation().state as DocSeedState | null
  return (
    <div className="flex h-full flex-col">
      <DocPane docId={docId} seed={seed} />
    </div>
  )
}
