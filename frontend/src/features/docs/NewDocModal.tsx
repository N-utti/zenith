import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Folder, Plus } from 'lucide-react'
import { RetryButton } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useCreateDoc, useCreateFolder, useTree } from './api'
import { FolderNameModal } from './FolderNameModal'
import { buildTree, folderRows } from './tree'

/**
 * 새 문서를 넣을 폴더를 고르고, 고르면 바로 만들어 편집기로 간다. 문서는 폴더 안에만 생긴다.
 * 사이드바의 폴더별 「새 문서」가 없는 자리(홈, 폴더를 안 연 문서 목록, AI 답변 저장)에서 쓴다.
 * 원하는 폴더가 없으면 「새 폴더」로 최상위에 폴더를 만들고 그 안에 바로 문서를 만든다.
 *
 * `seed` 는 편집기로 넘길 라우터 state(AI 답변 초안). 본문은 편집기가 빈 문서의 Y.Doc 에 심는다.
 */
export function NewDocModal({
  title = '새 문서',
  seed,
  onClose,
}: {
  title?: string
  seed?: unknown
  onClose: () => void
}) {
  const { data, isPending, isError, refetch } = useTree()
  const createDoc = useCreateDoc()
  const createFolder = useCreateFolder()
  /** 새 폴더 이름 입력창. 열려 있으면 실패 문구(`null` 이면 없음)를 들고 있다. */
  const [naming, setNaming] = useState<{ error: string | null } | null>(null)
  const busy = createDoc.isPending || createFolder.isPending
  const navigate = useNavigate()
  const toast = useToast()
  const rows = useMemo(() => (data ? folderRows(buildTree(data)) : []), [data])

  const createIn = (folderId: string) =>
    createDoc.mutate(
      { folder_id: folderId },
      {
        onSuccess: (doc) => {
          onClose()
          void navigate(`/docs/${doc.id}`, { state: seed })
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : '문서를 만들지 못했습니다.'),
      },
    )

  const create = (folderId: string) => {
    // 버튼이 비활성으로 바뀌기 전의 빠른 두 번째 탭. 문서가 두 개 생기지 않게 한다.
    if (!busy) createIn(folderId)
  }

  const submitFolder = (name: string) =>
    createFolder.mutate(
      { title: name, parent_id: null },
      {
        onSuccess: (folder) => {
          setNaming(null)
          // 여기서는 폴더를 막 만든 참이라 busy 가드를 거치지 않는다.
          createIn(folder.id)
        },
        // 입력창이 아직 열려 있다. 고칠 곳이 그 안에 있으니 입력 옆에 낸다.
        onError: (err) =>
          setNaming({ error: err instanceof ApiError ? err.message : '폴더를 만들지 못했습니다.' }),
      },
    )

  return (
    <Modal
      open
      // 만드는 중에 닫으면 문서는 생기는데 편집기로 못 간다.
      onClose={() => !busy && onClose()}
      title={title}
      description="어느 폴더에 만들까요?"
      size="sm"
    >
      {isPending && <SkeletonRows rows={4} />}
      {isError && !data && (
        <div className="space-y-1 py-2">
          <p className="text-danger text-sm">폴더 목록을 불러오지 못했습니다.</p>
          <RetryButton onClick={refetch} />
        </div>
      )}
      {data && rows.length === 0 && (
        <p className="text-subtle py-2 text-sm">아직 폴더가 없습니다. 새 폴더를 만들어 주세요.</p>
      )}
      <ul>
        {rows.map(({ folder, depth }) => (
          <li key={folder.id}>
            <button
              type="button"
              onClick={() => create(folder.id)}
              disabled={busy}
              className="text-fg hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 rounded-md py-2 pr-2 text-left text-sm transition-colors disabled:cursor-default"
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              {createDoc.isPending && createDoc.variables.folder_id === folder.id ? (
                <Spinner />
              ) : (
                <Folder className="text-subtle size-4 shrink-0" />
              )}
              <span className="truncate">{folder.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {data && (
        <button
          type="button"
          onClick={() => setNaming({ error: null })}
          disabled={busy}
          className="text-subtle hover:bg-surface-hover hover:text-fg flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors disabled:cursor-default"
        >
          <Plus className="size-4 shrink-0" />새 폴더
        </button>
      )}

      {naming && (
        <FolderNameModal
          title="새 폴더"
          submitLabel="만들기"
          pending={busy}
          error={naming.error}
          onDirty={() => setNaming({ error: null })}
          onSubmit={submitFolder}
          onClose={() => setNaming(null)}
        />
      )}
    </Modal>
  )
}
