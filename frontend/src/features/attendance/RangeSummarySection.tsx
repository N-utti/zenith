import { useState } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ApiError } from '@/lib/api'
import { toISODate } from '@/lib/datetime'
import { useAttendanceRange } from './api'
import { formatMinutes } from './attendanceDays'
import { Stat } from './Stat'

/**
 * 기본 구간: 올해 1월 1일부터 **이번 달 말일**까지.
 *
 * 오늘까지로 끊으면 이번 달의 남은 날이 잘려, 바로 위 달력과 휴가 숫자가 갈린다. 휴가·연장은
 * 승인된 계획이라 달 전체를 세고 근무일은 어차피 지난 날만 세기 때문에, 말일까지 잡아야 두 카드가
 * 같은 기준이 된다.
 */
function defaultRange(): { from: string; to: string } {
  const today = new Date()
  return {
    from: `${today.getFullYear()}-01-01`,
    to: toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  }
}

/**
 * 기간 집계(04 §10.1 `GET /attendance/me/summary`). 달력은 한 달만 보여 주는데, 연장근로 누계나
 * 올해 쓴 휴가처럼 달을 넘어가는 숫자를 볼 자리가 없었다.
 *
 * 합계만 그린다. 날짜별 상태는 위 달력이 이미 보여 준다.
 */
export function RangeSummarySection() {
  const [range] = useState(defaultRange)
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const reversed = from !== '' && to !== '' && from > to
  // 꺼진 쿼리는 `isPending` 이 계속 참이다. 날짜 칸을 비우면 스켈레톤이 영원히 남는다.
  const { data, isLoading, error } = useAttendanceRange(from, to)

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
              <Input
                {...slot}
                type="date"
                // 브라우저가 먼저 막는다. 문구는 직접 타이핑하는 경우에 남겨 둔다.
                min={from || undefined}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
        </div>

        {isLoading && <SkeletonRows rows={1} />}
        {error && (
          <p className="text-subtle text-sm">
            {/* 서버가 왜 막았는지 말해 주면 그대로 보인다(기간 상한 같은 것). */}
            {error instanceof ApiError && error.status === 422
              ? error.message
              : '기간 집계를 불러오지 못했습니다.'}
          </p>
        )}

        {data && (
          <>
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
            {/* 어느 구간을 센 값인지 숫자 옆에 남긴다. 칸을 다시 읽지 않아도 되게. */}
            <p className="text-subtle text-xs">
              {data.from} ~ {data.to}
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
