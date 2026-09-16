import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { currentMonth, formatDateTime, formatMonth } from '@/lib/datetime'
import { useCloseMonth, useReopenMonth, useYearClosings } from './api'

/**
 * 월 마감(임원, FR-ATT-15 · 10 §5.5). 한 해의 열두 달을 표로 놓고 행마다 마감·해제한다.
 * 마감하면 그 달의 휴가·예외 근무·정정 신청이 409 로 막히고, 해제는 사유를 받아 이력에 남긴다.
 * 리포트 내보내기·결근 확정은 아직 없다.
 */
export function MonthClosingSection() {
  const [year, setYear] = useState(() => Number(currentMonth().slice(0, 4)))
  const closings = useYearClosings(year)
  const [confirm, setConfirm] = useState<{ action: 'close' | 'reopen'; month: string } | null>(null)
  const now = currentMonth()
  const items = closings.data?.items ?? []
  // 해제 사유까지 한 줄로 보이게, 열두 달의 이력을 한 목록으로 합쳐 최신순.
  const history = items
    .flatMap((c) => c.history.map((h) => ({ ...h, month: c.month })))
    .sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <YearButton label="이전 해" onClick={() => setYear(Math.max(2000, year - 1))}>
            <ChevronLeft className="size-4" />
          </YearButton>
          <YearButton label="다음 해" onClick={() => setYear(Math.min(2100, year + 1))}>
            <ChevronRight className="size-4" />
          </YearButton>
        </div>
        <h2 className="text-fg text-base font-semibold">{year}년</h2>
        <p className="text-subtle ml-auto text-xs">
          마감하면 그 달의 휴가·예외 근무·정정 신청이 막힙니다.
        </p>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>달</TH>
            <TH>상태</TH>
            <TH>마감</TH>
            <TH className="text-right">
              <span className="sr-only">동작</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {closings.isPending && <TableEmpty colSpan={4}>불러오는 중</TableEmpty>}
          {closings.isError && (
            <TableEmpty colSpan={4}>
              {closings.error instanceof ApiError
                ? closings.error.message
                : '마감 상태를 불러오지 못했습니다.'}
            </TableEmpty>
          )}
          {items.map((c) => {
            const future = c.month > now
            return (
              <TR key={c.month} muted={future}>
                <TD className="font-medium whitespace-nowrap">{formatMonth(c.month)}</TD>
                <TD>
                  {future ? (
                    <span className="text-subtle text-sm">예정</span>
                  ) : (
                    <Badge tone={c.status === 'closed' ? 'success' : 'neutral'}>
                      {c.status === 'closed' ? '마감됨' : '미마감'}
                    </Badge>
                  )}
                </TD>
                <TD className="text-muted text-sm whitespace-nowrap">
                  {c.status === 'closed' && c.closed_at
                    ? `${formatDateTime(c.closed_at)} · ${c.closed_by?.name ?? ''}`
                    : '-'}
                </TD>
                <TD className="text-right">
                  {!future &&
                    (c.status === 'closed' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirm({ action: 'reopen', month: c.month })}
                      >
                        마감 해제
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => setConfirm({ action: 'close', month: c.month })}
                      >
                        마감
                      </Button>
                    ))}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>

      {history.length > 0 && (
        <Card>
          <CardHeader title="마감 이력" />
          <ul className="divide-line divide-y px-5 pb-2">
            {history.map((h) => (
              <li
                key={`${h.month}-${h.action}-${h.at}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm"
              >
                <span className="text-fg w-20 shrink-0 font-medium">{formatMonth(h.month)}</span>
                <Badge tone={h.action === 'close' ? 'success' : 'warning'}>
                  {h.action === 'close' ? '마감' : '해제'}
                </Badge>
                <span className="text-muted text-xs tabular-nums">{formatDateTime(h.at)}</span>
                <span className="text-fg">{h.by.name}</span>
                {/* 사유는 둘째 줄. 들여쓰기는 달 라벨 폭(w-20) + gap-x-3 만큼. */}
                {h.reason && (
                  <span className="text-muted basis-full pl-23 text-xs">사유: {h.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm?.action === 'close' && (
        <CloseModal month={confirm.month} onClose={() => setConfirm(null)} />
      )}
      {confirm?.action === 'reopen' && (
        <ReopenModal month={confirm.month} onClose={() => setConfirm(null)} />
      )}
    </div>
  )
}

function YearButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-muted hover:bg-surface-hover hover:text-fg rounded-md p-1.5 transition-colors"
    >
      {children}
    </button>
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
