import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { toISODate } from '@/lib/datetime'
import { useRequestCorrection } from './api'
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from './types'

/** 정정으로 바꿀 수 있는 상태. 휴가·반차는 휴가 신청으로, 휴일·결근은 관리자 몫이라 뺐다. */
const CORRECTION_STATUSES: AttendanceStatus[] = ['normal', 'remote', 'field', 'trip']

/**
 * 근태 정정 신청(10 §4.1 `att_corrections`). "저 날이 잘못됐다"는 사후 신고라 내 근태 캘린더 옆에 둔다.
 * 캘린더 칸을 누르면 그 날짜가 채워져 열린다. 열릴 때마다 마운트된다(호출부가 `open &&` 로 건다).
 */
export function CorrectionRequestModal({
  date,
  onClose,
}: {
  /** 캘린더에서 고른 날. 없으면 오늘. */
  date?: string
  onClose: () => void
}) {
  const toast = useToast()
  const request = useRequestCorrection()
  const today = toISODate(new Date())
  const [workDate, setWorkDate] = useState(date ?? today)
  const [status, setStatus] = useState<AttendanceStatus>('remote')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const dateError = !workDate ? '날짜를 선택해 주세요.' : null
  const canSubmit = !dateError && reason.trim().length > 0 && !request.isPending

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = () => {
    setError(null)
    request.mutate(
      { work_date: workDate, after: { status }, reason: reason.trim() },
      {
        onSuccess: () => {
          close()
          toast.success('정정을 신청했습니다. 승인되면 알려 드립니다.')
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : '정정을 신청하지 못했습니다.'),
      },
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title="근태 정정 신청"
      description="승인되면 그날 상태가 바뀌고 이전 값은 이력에 남습니다."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {request.isPending ? <Spinner className="border-t-on-accent" /> : '신청'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="일자" required error={dateError}>
            {(slot) => (
              <Input
                {...slot}
                type="date"
                value={workDate}
                // 정정은 지난 근무일에 대한 것이다. 미래 날짜를 받으면 목록 조회 범위 밖으로 삼켜진다.
                max={today}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="바꿀 상태" required>
            {(slot) => (
              <Select
                {...slot}
                value={status}
                onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                options={CORRECTION_STATUSES.map((s) => ({
                  value: s,
                  label: ATTENDANCE_STATUS_LABEL[s],
                }))}
              />
            )}
          </Field>
        </div>

        {/* 사유는 승인자와 본인에게만 보인다(10 §8). */}
        <Field label="사유" required>
          {(slot) => (
            <Textarea
              {...slot}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="무엇이 어떻게 잘못됐는지"
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
