import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatISODate } from '@/lib/datetime'
import { useClearAbsence, useSetAbsence } from './api'

/**
 * 결근 처리(백엔드 README 76). 근태 담당자와 임원이 근태 현황 표의 칸을 눌러 연다.
 *
 * 정상 근무로 잡힌 지난 근무일만 결근으로 바꿀 수 있다(서버가 판정한다). 이미 결근인 날은 메모를 고치거나
 * 취소한다. 본인이 정정 신청으로 바로잡아 승인되면 그쪽이 이긴다.
 * 부르는 쪽이 열 때 마운트한다(`FolderNameModal` 과 같은 이유).
 */
export function AbsenceModal({
  user,
  date,
  absent,
  note: initialNote,
  onClose,
}: {
  user: { id: string; name: string }
  date: string
  /** 지금 결근으로 잡혀 있나. */
  absent: boolean
  note: string | null
  onClose: () => void
}) {
  const [note, setNote] = useState(initialNote ?? '')
  const set = useSetAbsence()
  const clear = useClearAbsence()
  const toast = useToast()
  const pending = set.isPending || clear.isPending
  const failure = set.error ?? clear.error

  const close = () => {
    if (pending) return
    onClose()
  }
  const done = (message: string) => () => {
    toast.success(message)
    onClose()
  }

  return (
    <Modal
      open
      onClose={close}
      title={absent ? '결근 수정' : '결근 처리'}
      description={`${user.name} · ${formatISODate(date)}`}
      size="sm"
      footer={
        <>
          {absent && (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                clear.mutate(
                  { user_id: user.id, work_date: date },
                  { onSuccess: done('결근 처리를 취소했습니다.') },
                )
              }
            >
              결근 취소
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            닫기
          </Button>
          <Button
            variant={absent ? 'primary' : 'danger'}
            size="sm"
            disabled={pending}
            onClick={() =>
              set.mutate(
                { user_id: user.id, work_date: date, note: note.trim() || null },
                { onSuccess: done(absent ? '메모를 수정했습니다.' : '결근으로 처리했습니다.') },
              )
            }
          >
            {pending ? <Spinner className="border-t-on-accent" /> : absent ? '메모 저장' : '결근으로 처리'}
          </Button>
        </>
      }
    >
      <Field label="메모" hint="본인의 근태 달력에도 보입니다.">
        {(slot) => (
          <Input
            {...slot}
            autoFocus
            value={note}
            maxLength={200}
            placeholder="예: 무단결근"
            onChange={(e) => {
              setNote(e.target.value)
              set.reset()
              clear.reset()
            }}
          />
        )}
      </Field>
      {failure && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {failure instanceof ApiError ? failure.message : '처리하지 못했습니다.'}
        </p>
      )}
    </Modal>
  )
}
