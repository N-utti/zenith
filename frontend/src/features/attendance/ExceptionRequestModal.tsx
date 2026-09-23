import { useState } from 'react'
import { useNavigate } from 'react-router'
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
import { useRequestArrangement, useRequestOvertime } from './api'
import { formatMinutes } from './attendanceDays'
import { overtimeMinutes } from './overtimeMinutes'
import type { ArrangementKind } from './types'

/** 폼에서 고르는 종류. 재택·외근·출장은 각각 한 항목이고 연장·정정이 뒤에 온다. */
type FormKind = ArrangementKind | 'overtime'

const KIND_OPTIONS: Array<{ value: FormKind; label: string }> = [
  { value: 'remote', label: '재택' },
  { value: 'field', label: '외근' },
  { value: 'trip', label: '출장' },
  { value: 'overtime', label: '연장근로' },
]

/**
 * 예외 근무 신청 폼(05 SCR-ATT-03). 종류에 따라 입력이 바뀐다.
 * 재택·외근·출장은 기간, 연장근로는 일자·시각. 사유는 전부 필수(10 §7).
 * 사후 신고인 근태 정정은 여기 없다. 내 근태 캘린더 옆(`CorrectionRequestModal`)에 있다.
 * 열릴 때마다 마운트된다(호출부가 `open &&` 로 건다).
 */
export function ExceptionRequestModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const arrangement = useRequestArrangement()
  const overtime = useRequestOvertime()
  const today = toISODate(new Date())

  const [kind, setKind] = useState<FormKind>('remote')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 출장을 신청하고 나면 결의서를 이어 쓸지 묻는다. 그 출장의 id.
  const [tripId, setTripId] = useState<string | null>(null)

  const isArrangement = kind === 'remote' || kind === 'field' || kind === 'trip'
  // 오류는 그 입력에 붙인다. 시작일 오류를 종료일 밑에 내면 스크린리더가 멀쩡한 칸을 잘못됐다고 읽는다.
  const startError = !start ? '날짜를 선택해 주세요.' : null
  const endError =
    isArrangement && start && (!end || end < start) ? '종료일이 시작일보다 앞설 수 없습니다.' : null
  const startTimeError = kind === 'overtime' && !startTime ? '시각을 입력해 주세요.' : null
  const endTimeError = kind === 'overtime' && !endTime ? '시각을 입력해 주세요.' : null
  const timeError = startTimeError ?? endTimeError
  const preview = kind === 'overtime' && !timeError ? overtimeMinutes(startTime, endTime) : null
  const noOvertime = !!preview && preview.minutes === 0
  const pending = arrangement.isPending || overtime.isPending
  const canSubmit =
    !startError && !endError && !timeError && !noOvertime && reason.trim().length > 0 && !pending

  const close = () => {
    setError(null)
    onClose()
  }

  const done = () => {
    close()
    toast.success('신청했습니다. 승인되면 알려 드립니다.')
  }
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : '신청하지 못했습니다.')

  const submit = () => {
    setError(null)
    const body = { onSuccess: done, onError: fail }
    if (isArrangement) {
      arrangement.mutate(
        { kind, start_date: start, end_date: end, reason: reason.trim() },
        // 출장은 결의서가 딸린다(13 일반 기안). 닫지 않고 이어 쓸지 묻는 단계로 넘어간다.
        kind === 'trip' ? { onSuccess: (item) => setTripId(item.id), onError: fail } : body,
      )
    } else {
      overtime.mutate(
        {
          work_date: start,
          start_time: startTime,
          end_time: endTime,
          reason: reason.trim(),
        },
        body,
      )
    }
  }

  const description = isArrangement
    ? '사전 등록입니다. 승인되면 정상 근무로 집계됩니다.'
    : '소정 종업(18:00) 이후 구간만 인정됩니다. 승인된 신고분만 집계에 들어갑니다.'

  if (tripId) {
    return (
      <Modal
        open
        onClose={close}
        title="출장을 신청했습니다"
        description="승인되면 알려 드립니다. 출장비 결의서는 지금 쓰거나, 나중에 예외 근무 표의 출장 행에서 쓸 수 있습니다."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close}>
              나중에
            </Button>
            <Button size="sm" onClick={() => void navigate(`/approvals/new?arrangement=${tripId}`)}>
              결의서 작성
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm">
          결의서는 별도 결재 문서입니다. 출장 승인과 따로 진행되며, 출장 기간과 목적이 미리
          채워집니다.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title="예외 근무 신청"
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {pending ? <Spinner className="border-t-on-accent" /> : '신청'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="종류" required>
          {(slot) => (
            <Select
              {...slot}
              value={kind}
              onChange={(e) => setKind(e.target.value as FormKind)}
              options={KIND_OPTIONS}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={isArrangement ? '시작일' : '일자'} required error={startError}>
            {(slot) => (
              <Input
                {...slot}
                type="date"
                value={start}
                // 연장근로는 지난 근무일에 대한 신고다. 미래 날짜를 받으면 목록 조회 범위 밖으로 삼켜진다.
                max={isArrangement ? undefined : today}
                onChange={(e) => setStart(e.target.value)}
              />
            )}
          </Field>
          {isArrangement && (
            <Field label="종료일" required error={endError}>
              {(slot) => (
                <Input
                  {...slot}
                  type="date"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          )}
          {kind === 'overtime' && (
            <>
              <Field label="시작 시각" required error={startTimeError}>
                {(slot) => (
                  <Input
                    {...slot}
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                )}
              </Field>
              <Field label="종료 시각" required hint="시작보다 이르면 다음 날" error={endTimeError}>
                {(slot) => (
                  <Input
                    {...slot}
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </div>

        {/* 연장근로는 승인 전에 몇 분으로 잡히는지 보인다. 확정값은 서버가 준다(10 §5.3). */}
        {preview && (
          <p
            aria-live="polite"
            className={noOvertime ? 'text-danger text-sm' : 'text-muted text-sm'}
          >
            {noOvertime
              ? '18:00 이후 구간이 없습니다.'
              : `연장 ${formatMinutes(preview.minutes)}${preview.night_minutes > 0 ? ` (야간 ${formatMinutes(preview.night_minutes)} 포함)` : ''}`}
          </p>
        )}

        {/* 사유는 승인자와 본인에게만 보인다(10 §8). */}
        <Field label="사유" required>
          {(slot) => (
            <Textarea
              {...slot}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="사유를 입력하세요"
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
