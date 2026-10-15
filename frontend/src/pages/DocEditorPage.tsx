import { Link, useLocation, useParams } from 'react-router'
import { Forbidden } from '@/components/Forbidden'
import { Spinner } from '@/components/ui/Spinner'
import { useDoc } from '@/features/docs/api'
import { DocWorkspace } from '@/features/docs/DocWorkspace'
import { TrashedDoc } from '@/features/docs/TrashedDoc'
import type { DocSeedState } from '@/features/docs/types'
import { ApiError } from '@/lib/api'

export function DocEditorPage() {
  const { docId = '' } = useParams()
  const { data: meta, isPending, isError, error } = useDoc(docId)
  // AI 답변 "문서로 저장"이 실어 보낸 초안. 문서가 비어 있는 첫 탭에서만 심긴다(DocWorkspace onCreate).
  const seed = useLocation().state as DocSeedState | null

  if (isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  // 폴더 열람 권한(백엔드 #421). 링크로 들어왔거나, 편집 중에 권한이 회수돼 다시 받은 경우다
  // (`useCollabSession` 의 4403). 다시 받다 실패하면 앞서 받은 `meta` 가 남아 있어 isError 를 먼저 본다.
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Forbidden to="/docs" back="문서 목록으로" contact="폴더를 관리하는 임원에게">
        이 문서가 든 폴더를 볼 수 있는 권한이 없습니다.
      </Forbidden>
    )
  }

  if (isError || !meta) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-fg text-lg font-semibold">
          {/* 다시 받다 실패한 서버·네트워크 오류도 여기로 온다. 404 만 「없다」고 말한다. */}
          {error instanceof ApiError && error.status !== 404
            ? '문서를 불러오지 못했습니다'
            : '문서를 찾을 수 없습니다'}
        </h1>
        <Link to="/docs" className="text-accent mt-4 inline-block text-sm hover:underline">
          문서 목록으로 →
        </Link>
      </div>
    )
  }

  // 휴지통에 든 문서는 읽을 수만 있다(서버가 쓰기를 전부 404 로 막는다). 편집기를 띄우면
  // 타이핑이 이 브라우저에만 쌓이고 저장 실패는 아무 데도 안 보인다.
  if (meta.deleted_at) return <TrashedDoc meta={meta} />

  // 상단 경로 줄은 DocWorkspace가 그린다. 편집자 표시가 협업 세션을 필요로 해서다.
  // docId가 바뀌면 협업 세션을 통째로 새로 연다.
  return (
    <div className="flex h-full flex-col">
      <DocWorkspace key={meta.id} meta={seed?.seedHtml ? { ...meta, ...seed } : meta} />
    </div>
  )
}
