import { useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MonthHeader } from '@/components/ui/Calendar'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { currentMonth, formatDateTime, formatMonth } from '@/lib/datetime'
import { useCloseMonth, useMonthClosing, useReopenMonth } from './api'

/**
 * 월 마감(임원, FR-ATT-15 · 10 §5.5). 마감하면 그 달의 휴가·예외 근무·정정 신청이 409 로 막히고,
 * 해제는 사유를 받아 이력에 남긴다. 리포트 내보내기·결근 확정은 아직 없다.
 */
export function MonthClosingSection() {
  const [month, setMonth] = useState(currentMonth)
  const closing = useMonthClosing(month)
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null)
  const data = closing.data
  const future = month > currentMonth()

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <MonthHeader month={month} onMonthChange={setMonth} />
        {closing.isPending && <p className="text-subtle text-sm">불러오는 중</p>}
        {closing.isError && (
          <p className="text-danger text-sm">
            {closing.error instanceof ApiError
              ? closing.error.message
              : '마감 상태를 불러오지 못했습니다.'}
          </p>
        )}
        {data && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className="bg-sunken text-muted grid size-9 place-items-center rounded-lg">
                {data.status === 'closed' ? (
                  <Lock className="size-4" aria-hidden="true" />
                ) : (
                  <LockOpen className="size-4" aria-hidden="true" />
                )}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-fg text-sm font-semibold">{formatMonth(month)}</span>
                  <Badge tone={data.status === 'closed' ? 'success' : 'neutral'}>
                    {data.status === 'closed' ? '마감됨' : '미마감'}
                  </Badge>
                </div>
                <p className="text-subtle text-xs">
                  {data.status === 'closed' && data.closed_at
                    ? `${formatDateTime(data.closed_at)} · ${data.closed_by?.name ?? ''}`
                    : future
                      ? '아직 오지 않은 달입니다.'
                      : '마감하면 이 달의 휴가·예외 근무·정정 신청이 막힙니다.'}
                </p>
              </div>
            </div>
            <div className="ml-auto">
              {data.status === 'closed' ? (
                <Button variant="secondary" size="sm" onClick={() => setConfirm('reopen')}>
                  마감 해제
                </Button>
              ) : (
                <Button size="sm" onClick={() => setConfirm('close')} disabled={future}>
                  이 달 마감
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {data && data.history.length > 0 && (
        <Card>
          <CardHeader title="마감 이력" />
          <ul className="divide-line divide-y px-5 pb-2">
            {data.history.map((h) => (
              <li
                key={`${h.action}-${h.at}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm"
              >
                <Badge tone={h.action === 'close' ? 'success' : 'warning'}>
                  {h.action === 'close' ? '마감' : '해제'}
                </Badge>
                <span className="text-muted text-xs tabular-nums">{formatDateTime(h.at)}</span>
                <span className="text-fg">{h.by.name}</span>
                {h.reason && (
                  <span className="text-muted basis-full text-xs">사유: {h.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm === 'close' && <CloseModal month={month} onClose={() => setConfirm(null)} />}
      {confirm === 'reopen' && <ReopenModal month={month} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function CloseModal({ month, onClose }: { month: string; onClose: () => void }) {
  const toast = useToast()
  const close = useCloseMonth()
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setError(null)
    close.mutate(month, {
      onSuccess: () => {
        onClose()
        toast.success(`${formatMonth(month)} 근태를 마감했습니다.`)
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : '마감하지 못했습니다.'),
    })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${formatMonth(month)} 근태를 마감할까요?`}
      description="마감하면 이 달의 신청과 정정이 막히고 기록이 확정됩니다. 다시 열려면 사유를 남겨야 합니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={close.isPending}>
            {close.isPending ? <Spinner className="border-t-on-accent" /> : '마감'}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </Modal>
  )
}

function ReopenModal({ month, onClose }: { month: string; onClose: () => void }) {
  const toast = useToast()
  const reopen = useReopenMonth()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setError(null)
    reopen.mutate(
      { month, reason: reason.trim() },
      {
        onSuccess: () => {
          onClose()
          toast.success(`${formatMonth(month)} 마감을 해제했습니다.`)
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : '해제하지 못했습니다.'),
      },
    )
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${formatMonth(month)} 마감을 해제할까요?`}
      description="해제하면 이 달의 신청과 정정이 다시 열립니다. 사유는 이력과 감사 로그에 남습니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={!reason.trim() || reopen.isPending}>
            {reopen.isPending ? <Spinner className="border-t-on-accent" /> : '해제'}
          </Button>
        </>
      }
    >
      <Field label="사유" required>
        {(slot) => (
          <Textarea
            {...slot}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="예: 누락된 연장근로 정정 반영"
            autoFocus
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-danger mt-2 text-sm">
          {error}
        </p>
      )}
    </Modal>
  )
}
