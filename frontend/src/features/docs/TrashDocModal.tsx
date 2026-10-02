import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { untrashDoc, useTrashDoc } from './api'

/**
 * 문서를 휴지통으로 보낼지 묻고 보낸다. 편집 화면의 휴지통 버튼과 사이드바 우클릭 메뉴가 같이 쓴다.
 * 부르는 쪽이 열 때 마운트한다.
 *
 * 토스트의 버튼이 바로 되돌리는 길이고, 놓쳤으면 휴지통 화면(`/docs/trash`)에서 되돌린다.
 * 그래서 토스트를 오래 띄운다.
 */
export function TrashDocModal({
  id,
  title,
  onClose,
  onTrashed,
}: {
  id: string
  title: string
  onClose: () => void
  /** 휴지통으로 간 뒤. 그 문서를 보고 있던 화면은 여기서 떠난다. */
  onTrashed?: () => void
}) {
  const toast = useToast()
  const trash = useTrashDoc(id)

  const moveToTrash = () =>
    trash.mutate(undefined, {
      onSuccess: () => {
        onClose()
        onTrashed?.()
        // 제목을 싣는다. 짧은 사이에 둘을 지우면 똑같은 토스트가 겹쳐 어느 것을 되돌리는지
        // 가릴 근거가 없어진다.
        toast.success(`${title} 문서를 휴지통으로 옮겼습니다.`, {
          durationMs: 10_000,
          action: {
            label: '되돌리기',
            // 여기는 이미 이 대화상자가 닫힌 뒤다. 되돌린 문서로 다시 들어가지 않고 목록에 다시
            // 나타나게만 한다.
            onClick: () => {
              void untrashDoc(id)
                .then(() => toast.success('문서를 되돌렸습니다.'))
                .catch((err: unknown) =>
                  toast.error(err instanceof ApiError ? err.message : '되돌리지 못했습니다.'),
                )
            },
          },
        })
      },
      onError: (err) => {
        onClose()
        toast.error(err instanceof ApiError ? err.message : '휴지통으로 옮기지 못했습니다.')
      },
    })

  return (
    <Modal
      open
      onClose={() => {
        if (!trash.isPending) onClose()
      }}
      title="휴지통으로 옮길까요?"
      description="30일 동안 되돌릴 수 있고, 그 뒤에는 영구 삭제됩니다. 다른 사람에게도 사라집니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={trash.isPending}>
            취소
          </Button>
          <Button variant="danger" size="sm" onClick={moveToTrash} disabled={trash.isPending}>
            {trash.isPending ? <Spinner className="border-t-white" /> : '휴지통으로'}
          </Button>
        </>
      }
    >
      <p className="text-muted text-sm leading-relaxed">{title}</p>
    </Modal>
  )
}
