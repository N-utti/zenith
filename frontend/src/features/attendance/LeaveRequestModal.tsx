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
import { useRequestLeave } from './api'
import { leaveDays } from './leaveDays'
import type { LeaveBalance, LeaveType } from './types'

/**
 * 휴가 신청 폼(05 SCR-ATT-02). 종류·기간·사유를 받아 `POST /leaves` 로 보낸다.
 * 열릴 때마다 마운트된다(호출부가 `open &&` 로 건다). 지난 신청의 날짜가 남지 않는다.
 */
export function LeaveRequestModal({
  onClose,
  types,
  balance,
}: {
  onClose: () => void
  types: LeaveType[]
  balance: LeaveBalance
}) {
  const request = useRequestLeave()
  const toast = useToast()
  const today = toISODate(new Date())
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? '')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const type = types.find((t) => t.code === typeCode)
  // 반차는 하루짜리다. 종료일 입력을 보이지 않고 시작일과 같게 보낸다.
  const endDate = type?.unit === 'half' ? start : end
  // 날짜 입력은 지울 수 있다. 빈 값은 문자열 비교를 통과하므로 따로 잡는다.
  const rangeError = !start || !endDate
    ? '날짜를 선택해 주세요.'
    : endDate < start
      ? '종료일이 시작일보다 앞설 수 없습니다.'
      : null
  const days = type && !rangeError ? leaveDays(type, start, endDate) : 0
  const overBalance = days > balance.remaining
  // 연차인데 주말만 골라 차감이 0 이면 신청할 게 없다. 공가(차감 0 종류)와는 다른 상태다.
  const noWorkday = !!type && type.deduct_days > 0 && !rangeError && days === 0
  // 연차·반차는 사유를 묻지 않는다. 회사는 시기만 조정할 수 있지 이유로 거부할 수 없다(근기법 §60).
  // 차감 없이 쉬는 병가·경조사·공가는 무엇 때문인지가 승인 근거라 필수.
  const needsReason = !!type && type.deduct_days === 0
  const canSubmit =
    !!type &&
    !rangeError &&
    !overBalance &&
    !noWorkday &&
    (!needsReason || reason.trim().length > 0) &&
    !request.isPending

  const hint = rangeError
    ? null
    : overBalance
      ? `잔여 연차(${balance.remaining}일)를 넘습니다. 기간을 줄여 주세요.`
      : noWorkday
        ? '선택한 기간에 근무일이 없습니다.'
        : days > 0
          ? `연차 ${days}일이 차감됩니다. (주말 제외)`
          : '연차가 차감되지 않는 휴가입니다.'

  // 날짜 입력의 상한. 없으면 9999년까지 받아 일수 루프가 렌더마다 수 초씩 돈다.
  const maxDate = `${balance.year + 1}-12-31`

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = () => {
    setError(null)
    request.mutate(
      {
        type_code: typeCode,
        start_date: start,
        end_date: endDate,
        ...(needsReason ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          close()
          toast.success('휴가를 신청했습니다. 승인되면 알려 드립니다.')
        },
        // 잔여 부족(422)·마감된 달(409)처럼 서버만 아는 거절은 폼 안에 낸다.
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : '휴가를 신청하지 못했습니다.'),
      },
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title="휴가 신청"
      description={`${balance.year}년 잔여 연차 ${balance.remaining}일. 팀장 승인 후 반영됩니다.`}
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
        <Field label="종류" required>
          {(slot) => (
            <Select
              {...slot}
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
              options={types.map((t) => ({ value: t.code, label: t.name }))}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={type?.unit === 'half' ? '날짜' : '시작일'}
            required
            error={type?.unit === 'half' ? rangeError : null}
          >
            {(slot) => (
              <Input
                {...slot}
                type="date"
                value={start}
                max={maxDate}
                onChange={(e) => setStart(e.target.value)}
              />
            )}
          </Field>
          {type?.unit !== 'half' && (
            <Field label="종료일" required error={rangeError}>
              {(slot) => (
                <Input
                  {...slot}
                  type="date"
                  value={end}
                  min={start}
                  max={maxDate}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>

        {/* 버튼이 잠기는 이유가 여기 뜬다. 라이브 리전이어야 스크린리더도 듣는다. */}
        <p
          aria-live="polite"
          className={overBalance || noWorkday ? 'text-danger text-sm' : 'text-muted text-sm'}
        >
          {hint}
        </p>

        {/* 사유는 승인자와 본인에게만 보인다(10 §8 민감정보). Enter 로 제출하지 않는다. */}
        {needsReason && (
          <Field label="사유" required>
            {(slot) => (
              <Textarea
                {...slot}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="사유를 입력하세요"
              />
            )}
          </Field>
        )}

        {/* 잔여 부족·마감된 달처럼 서버만 아는 거절. 특정 입력의 오류가 아니라 폼 전체의 오류다. */}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
