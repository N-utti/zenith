import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import { useCancelLeave, useLeaveBalance, useLeaveTypes, useMyLeaves } from './api'
import { expiringSoon } from './leaveBalance'
import { LeaveRequestModal } from './LeaveRequestModal'
import { Stat } from './Stat'
import { LEAVE_STATUS_LABEL, REQUEST_STATUS_TONE } from './types'

/** 05 SCR-ATT-02: 잔여 요약 + 신청 버튼 + 내 휴가 목록 + 소멸 예정 경고. */
export function LeaveSection() {
  const balance = useLeaveBalance()
  const types = useLeaveTypes()
  const leaves = useMyLeaves()
  const cancel = useCancelLeave()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  // 04 는 목록을 `{items}` 로 감싼다고 못 박지 않았다. 배열이 그냥 오면 빈 목록으로 버틴다.
  const items = leaves.data?.items ?? []
  const typeName = (code: string) => types.data?.items.find((t) => t.code === code)?.name ?? code

  const onCancel = (id: string) => {
    if (!confirm('이 휴가 신청을 취소할까요?')) return
    cancel.mutate(id, {
      onSuccess: () => toast.success('휴가 신청을 취소했습니다.'),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : '취소하지 못했습니다.'),
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="연차" />
        {balance.isPending && <SkeletonRows rows={1} />}
        {balance.isError && <CardEmpty>연차 잔여를 불러오지 못했습니다.</CardEmpty>}
        {balance.data && (
          <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-4">
            <dl className="flex gap-6">
              <Stat label="부여" value={balance.data.granted} />
              <Stat label="사용" value={balance.data.used} />
              <Stat label="잔여" value={balance.data.remaining} strong />
            </dl>
            <div className="flex flex-col items-end gap-1.5">
              <Button
                size="sm"
                onClick={() => setOpen(true)}
                disabled={!types.data || types.data.items.length === 0}
              >
                <Plus className="size-4" />
                휴가 신청
              </Button>
              <p
                className={
                  expiringSoon(balance.data) ? 'text-warning text-xs' : 'text-subtle text-xs'
                }
              >
                {expiringSoon(balance.data) ? '소멸 예정: ' : '소멸일: '}
                {balance.data.expires_on}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Table label="내 휴가 목록" wide>
        <THead>
          <tr>
            <TH>종류</TH>
            <TH>기간</TH>
            <TH className="text-right">차감</TH>
            <TH>상태</TH>
            <TH>신청</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {leaves.isPending && <TableEmpty colSpan={6}>불러오는 중</TableEmpty>}
          {leaves.isError && <TableEmpty colSpan={6}>휴가 목록을 불러오지 못했습니다.</TableEmpty>}
          {leaves.data && items.length === 0 && (
            <TableEmpty colSpan={6}>아직 신청한 휴가가 없습니다.</TableEmpty>
          )}
          {items.map((leave) => (
            <TR key={leave.id} muted={leave.status === 'canceled'}>
              <TD>{typeName(leave.type_code)}</TD>
              <TD className="whitespace-nowrap">
                {leave.start_date === leave.end_date
                  ? leave.start_date
                  : `${leave.start_date} ~ ${leave.end_date}`}
              </TD>
              <TD className="text-right tabular-nums">{leave.days}일</TD>
              <TD>
                <Badge tone={REQUEST_STATUS_TONE[leave.status]}>
                  {LEAVE_STATUS_LABEL[leave.status]}
                </Badge>
              </TD>
              <TD className="text-muted whitespace-nowrap">
                {/* "1시간 전"은 읽기 편하지만 언제인지는 모른다. 커서를 올리면 정확한 시각. */}
                <time dateTime={leave.created_at} title={formatDateTime(leave.created_at)}>
                  {formatRelative(leave.created_at)}
                </time>
              </TD>
              <TD className="text-right">
                {/* 승인 전에만 취소할 수 있다(04 §10.2). 승인 뒤는 서버가 409 로 막는다. */}
                {leave.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(leave.id)}
                    disabled={cancel.isPending && cancel.variables === leave.id}
                  >
                    취소
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {open && balance.data && types.data && (
        <LeaveRequestModal
          onClose={() => setOpen(false)}
          types={types.data.items}
          balance={balance.data}
        />
      )}
    </div>
  )
}
