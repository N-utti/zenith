import { useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { useApprovals } from '@/features/approvals/api'
import { statusLabel, statusTone } from '@/features/approvals/types'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import {
  useCancelException,
  useMyArrangements,
  useMyCorrections,
  useMyOvertime,
  type ExceptionKind,
} from './api'
import { formatMinutes } from './attendanceDays'
import { ExceptionRequestModal } from './ExceptionRequestModal'
import { Stat } from './Stat'
import {
  ATTENDANCE_STATUS_LABEL,
  LEAVE_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type Arrangement,
  type ArrangementKind,
  type Correction,
  type Overtime,
  type RequestStatus,
} from './types'

/** 세 종류의 신청을 한 표에 그리기 위한 공통 모양. */
interface Row {
  kind: ExceptionKind
  id: string
  label: string
  /** 정렬 기준이자 첫 열. 기간이면 시작일. */
  date: string
  period: string
  detail: string
  status: RequestStatus
  created_at: string
  /** 예외 근무의 세부 종류. 결의서가 딸리는 출장인지 표시 문구가 아니라 이것으로 본다. */
  subKind?: ArrangementKind
}

const period = (start: string, end: string) => (start === end ? start : `${start} ~ ${end}`)

function toRows(
  arrangements: Arrangement[],
  overtime: Overtime[],
  corrections: Correction[],
): Row[] {
  const rows: Row[] = [
    ...arrangements.map((r) => ({
      kind: 'arrangement' as const,
      id: r.id,
      subKind: r.kind,
      label: ATTENDANCE_STATUS_LABEL[r.kind],
      date: r.start_date,
      period: period(r.start_date, r.end_date),
      detail: r.reason,
      status: r.status,
      created_at: r.created_at,
    })),
    ...overtime.map((r) => ({
      kind: 'overtime' as const,
      id: r.id,
      label: '연장근로',
      date: r.work_date,
      period: r.work_date,
      detail: `${r.start_time}~${r.end_time} · ${formatMinutes(r.minutes)}${r.night_minutes > 0 ? ` (야간 ${formatMinutes(r.night_minutes)})` : ''}`,
      status: r.status,
      created_at: r.created_at,
    })),
    ...corrections.map((r) => ({
      kind: 'correction' as const,
      id: r.id,
      label: '정정',
      date: r.work_date,
      period: r.work_date,
      detail: r.after.status
        ? `${ATTENDANCE_STATUS_LABEL[r.after.status]}(으)로 정정`
        : (r.after.note ?? ''),
      status: r.status,
      created_at: r.created_at,
    })),
  ]
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  )
}

/** 05 SCR-ATT-03: 연장 누계 + 신청 버튼 + 재택·외근·출장 / 연장근로 / 정정 신청 목록. */
export function ExceptionSection() {
  const year = new Date().getFullYear()
  const arrangements = useMyArrangements()
  const overtime = useMyOvertime(`${year}-01-01`, `${year}-12-31`)
  const corrections = useMyCorrections()
  const cancel = useCancelException()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  // 출장 행에 결의서 상태를 붙인다. 출장 승인과 결의서는 별개 문서라 상태도 따로 보인다(2026-09-08 결정).
  // 임시저장도 본다. 안 그러면 저장만 해 둔 결의서를 두고 "결의서 작성"이 또 떠서 두 장이 된다.
  const sent = useApprovals('sent')
  const drafts = useApprovals('draft')
  const expenseOf = (arrangementId: string) =>
    [...(sent.data?.items ?? []), ...(drafts.data?.items ?? [])].find(
      (d) => d.related?.type === 'arrangement' && d.related.id === arrangementId,
    )

  const isPending = arrangements.isPending || overtime.isPending || corrections.isPending
  const isError = arrangements.isError || overtime.isError || corrections.isError
  const rows = toRows(
    arrangements.data?.items ?? [],
    overtime.data?.items ?? [],
    corrections.data?.items ?? [],
  )

  const onCancel = (row: Row) => {
    if (!confirm('이 신청을 취소할까요?')) return
    cancel.mutate(
      { kind: row.kind, id: row.id },
      {
        onSuccess: () => toast.success('신청을 취소했습니다.'),
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : '취소하지 못했습니다.'),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          {overtime.isPending && <SkeletonRows rows={1} />}
          {overtime.isError && (
            <p className="text-subtle text-sm">연장근로 누계를 불러오지 못했습니다.</p>
          )}
          {overtime.data && (
            <dl className="flex flex-wrap gap-6">
              {/* 실측이 아니라 신고분이다(10 §1.4). 52시간 게이지처럼 그리지 않는다. */}
              <Stat
                label={`${year}년 연장근로`}
                value={formatMinutes(overtime.data.summary.minutes)}
                unit=""
                hint="승인 신고 기준"
              />
              <Stat
                label="야간"
                value={formatMinutes(overtime.data.summary.night_minutes)}
                unit=""
                hint="22시~06시 구간"
              />
            </dl>
          )}
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            예외 근무 신청
          </Button>
        </div>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH>종류</TH>
            <TH>일자</TH>
            <TH>내용</TH>
            <TH>상태</TH>
            <TH>결의서</TH>
            <TH>신청</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {isPending && <TableEmpty colSpan={7}>불러오는 중</TableEmpty>}
          {isError && !isPending && (
            <TableEmpty colSpan={7}>신청 목록을 불러오지 못했습니다.</TableEmpty>
          )}
          {!isPending && !isError && rows.length === 0 && (
            <TableEmpty colSpan={7}>아직 신청한 예외 근무가 없습니다.</TableEmpty>
          )}
          {rows.map((row) => {
            const expense =
              row.subKind === 'trip' && row.status !== 'canceled' ? expenseOf(row.id) : undefined
            return (
              <TR key={`${row.kind}:${row.id}`} muted={row.status === 'canceled'}>
                <TD>{row.label}</TD>
                <TD className="whitespace-nowrap">{row.period}</TD>
                <TD className="text-muted max-w-xs truncate" title={row.detail}>
                  {row.detail}
                </TD>
                <TD>
                  <Badge tone={REQUEST_STATUS_TONE[row.status]}>
                    {LEAVE_STATUS_LABEL[row.status]}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap">
                  {expense && (
                    <Link to={`/approvals/${expense.id}`} aria-label="출장비 결의서 보기">
                      <Badge tone={statusTone(expense.status)}>{statusLabel(expense.status)}</Badge>
                    </Link>
                  )}
                  {!expense && row.subKind === 'trip' && row.status !== 'canceled' && (
                    <Link
                      to={`/approvals/new?arrangement=${row.id}`}
                      className="text-accent text-xs hover:underline"
                    >
                      결의서 작성
                    </Link>
                  )}
                </TD>
                <TD className="text-muted whitespace-nowrap">
                  <time dateTime={row.created_at} title={formatDateTime(row.created_at)}>
                    {formatRelative(row.created_at)}
                  </time>
                </TD>
                <TD className="text-right">
                  {row.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${row.label} ${row.period} 신청 취소`}
                      onClick={() => onCancel(row)}
                      disabled={
                        cancel.isPending &&
                        cancel.variables?.kind === row.kind &&
                        cancel.variables.id === row.id
                      }
                    >
                      취소
                    </Button>
                  )}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>

      {open && <ExceptionRequestModal onClose={() => setOpen(false)} />}
    </div>
  )
}
