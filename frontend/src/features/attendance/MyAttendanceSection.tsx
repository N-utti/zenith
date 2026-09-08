import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Calendar, CalendarDayNumber, type CalendarDay } from '@/components/ui/Calendar'
import { Card } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { currentMonth, formatISODate } from '@/lib/datetime'
import { useLeaveBalance, useLeaveTypes, useMyAttendance } from './api'
import { cellStatus, formatMinutes, indexByDate, type CellStatus } from './attendanceDays'
import { LeaveRequestModal } from './LeaveRequestModal'
import { Stat } from './Stat'
import { ATTENDANCE_STATUS_LABEL, type AttendanceDay } from './types'

/**
 * 05 상태 색상 규약: 휴가·반차 파랑(accent) / 재택·외근·출장 청록(info) / 휴일 연회색 / 결근 빨강.
 * 정상은 칠하지 않는다. 평일의 기본값이 정상이라(10 §1.2) 색을 주면 달력 전체가 회색이 된다.
 * 칩 색은 `Badge` 의 accent·danger, 홈 캘린더의 휴가 칩과 같다.
 */
const TONE: Partial<Record<CellStatus, string>> = {
  leave: 'bg-accent-soft text-accent',
  half_leave: 'bg-accent-soft text-accent',
  remote: 'bg-info/12 text-info',
  field: 'bg-info/12 text-info',
  trip: 'bg-info/12 text-info',
  holiday: 'bg-sunken text-subtle',
  absent: 'bg-danger/12 text-danger',
}

/** 범례 견본(단색). 칩과 같은 계열이되 진하게 해서 작은 네모로도 구분된다. */
const LEGEND: Array<[label: string, solid: string]> = [
  ['휴가·반차', 'bg-accent'],
  ['재택·외근·출장', 'bg-info'],
  ['휴일', 'bg-line-strong'],
  ['결근', 'bg-danger'],
]

/** 05 SCR-ATT-01: 월 집계 + 잔여 연차 + 신청 버튼 + 상태 색 캘린더. */
export function MyAttendanceSection() {
  const [month, setMonth] = useState(currentMonth)
  const [open, setOpen] = useState(false)
  const attendance = useMyAttendance(month)
  const balance = useLeaveBalance()
  const types = useLeaveTypes()
  const byDate = indexByDate(attendance.data?.days ?? [])
  const summary = attendance.data?.summary

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          {attendance.isPending && <SkeletonRows rows={1} />}
          {attendance.isError && <p className="text-subtle text-sm">근태를 불러오지 못했습니다.</p>}
          {summary && (
            <dl className="flex flex-wrap gap-6">
              <Stat label="근무" value={summary.worked_days} />
              <Stat label="휴가" value={summary.leave_days} />
              {/* 실근로시간을 재지 않으므로 신고분만 담긴 값이다. 라벨 없이 두면 실측처럼 읽힌다(10 §5.3). */}
              <Stat
                label="연장근로"
                value={formatMinutes(summary.overtime_minutes)}
                unit=""
                hint={
                  summary.night_minutes > 0
                    ? `승인 신고 기준 · 야간 ${formatMinutes(summary.night_minutes)} 포함`
                    : '승인 신고 기준'
                }
              />
            </dl>
          )}
          {/* 휴가 신청은 근태 조회와 별개다. 근태가 안 와도 잔여와 버튼은 보여야 한다. */}
          {balance.data && (
            <div className="flex items-end gap-4">
              <dl>
                <Stat label="잔여 연차" value={balance.data.remaining} strong />
              </dl>
              <Button
                size="sm"
                onClick={() => setOpen(true)}
                disabled={!types.data || types.data.items.length === 0}
              >
                <Plus className="size-4" />
                휴가 신청
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <Calendar
          month={month}
          onMonthChange={setMonth}
          // 좁은 화면에서는 범례가 월 제목을 두 줄로 밀어낸다. 그때는 격자 아래로 내린다.
          actions={<Legend className="hidden sm:flex" />}
          className={cn(attendance.isPending && 'animate-pulse opacity-60')}
          renderDay={(day) => (
            <DayCell day={day} row={byDate.get(day.iso)} status={cellStatus(byDate, day)} />
          )}
        />
        <Legend className="mt-3 flex sm:hidden" />
        {attendance.data && attendance.data.days.length === 0 && (
          <p className="text-subtle mt-3 text-center text-xs">이 달의 근무 달력이 아직 없습니다.</p>
        )}
      </Card>

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

function DayCell({
  day,
  row,
  status,
}: {
  day: CalendarDay
  row: AttendanceDay | undefined
  status: CellStatus
}) {
  const tone = TONE[status]
  const label = status === 'none' ? null : ATTENDANCE_STATUS_LABEL[status]
  const overtime = row && row.overtime_minutes > 0 ? `+${formatMinutes(row.overtime_minutes)}` : null
  const title = [formatISODate(day.iso), label, overtime && `연장 ${overtime.slice(1)}`, row?.note]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      title={title}
      className={cn('flex h-full flex-col items-start gap-0.5', !day.inMonth && 'opacity-60')}
    >
      <CalendarDayNumber day={day} />
      {/* 좁은 화면에서는 글자가 한 자씩만 남아 읽을 수 없다. 점으로 색만 보이고, 라벨은 읽기 전용으로 남긴다. */}
      {tone && label && (
        <span className={cn('ml-0.5 size-1.5 rounded-full sm:hidden', tone)}>
          <span className="sr-only">{label}</span>
        </span>
      )}
      {tone && label && (
        <span className={cn('hidden w-full truncate rounded px-1 text-[11px] leading-4 sm:block', tone)}>
          {label}
        </span>
      )}
      {overtime && (
        <span className="text-muted hidden px-1 text-[11px] leading-4 tabular-nums sm:block">
          {overtime}
        </span>
      )}
    </div>
  )
}

function Legend({ className }: { className?: string }) {
  return (
    <div className={cn('text-subtle flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)}>
      {LEGEND.map(([label, solid]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={cn('size-2.5 rounded-sm', solid)} />
          {label}
        </span>
      ))}
    </div>
  )
}
