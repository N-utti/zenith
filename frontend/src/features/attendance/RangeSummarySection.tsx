import { useState } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { toISODate } from '@/lib/datetime'
import { useAttendanceRange } from './api'
import { formatMinutes } from './attendanceDays'
import { Stat } from './Stat'

/** 기본 구간: 올해 1월 1일부터 오늘까지. 연장근로·연차가 해 단위로 관리된다. */
function yearToDate(): { from: string; to: string } {
  const today = new Date()
  return { from: `${today.getFullYear()}-01-01`, to: toISODate(today) }
}

/**
 * 기간 집계(04 §10.1 `GET /attendance/me/summary`). 달력은 한 달만 보여 주는데, 연장근로 누계나
 * 올해 쓴 휴가처럼 달을 넘어가는 숫자를 볼 자리가 없었다.
 *
 * 합계만 그린다. 날짜별 상태는 위 달력이 이미 보여 준다.
 */
export function RangeSummarySection() {
  const initial = yearToDate()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const reversed = from !== '' && to !== '' && from > to
  const { data, isPending, isError } = useAttendanceRange(from, to)

  return (
    <Card>
      <CardHeader title="기간 집계" />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작일">
            {(slot) => (
              <Input {...slot} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            )}
          </Field>
          <Field label="종료일" error={reversed ? '종료일이 시작일보다 앞섭니다.' : null}>
            {(slot) => (
              <Input {...slot} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
        </div>

        {isPending && !reversed && <SkeletonRows rows={1} />}
        {isError && <p className="text-subtle text-sm">기간 집계를 불러오지 못했습니다.</p>}

        {data && (
          <dl className="flex flex-wrap gap-6">
            <Stat label="근무" value={data.summary.worked_days} />
            <Stat label="휴가" value={data.summary.leave_days} />
            {/* 실근로시간을 재지 않으므로 신고분만 담긴 값이다(10 §5.3). 달 집계와 같은 라벨을 쓴다. */}
            <Stat
              label="연장근로"
              value={formatMinutes(data.summary.overtime_minutes)}
              unit=""
              hint={
                data.summary.night_minutes > 0
                  ? `승인 신고 기준 · 야간 ${formatMinutes(data.summary.night_minutes)} 포함`
                  : '승인 신고 기준'
              }
            />
          </dl>
        )}
      </div>
    </Card>
  )
}
