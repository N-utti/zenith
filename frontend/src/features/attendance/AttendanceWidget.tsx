import { Link } from 'react-router'
import { AlertTriangle, LogIn, LogOut, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDay, formatMinutes, formatTime } from '@/lib/datetime'
import { useMinuteClock } from '@/lib/useNow'
import { useAttendanceSummary, usePunch, useUndoCheckOut } from './api'
import type { AttendanceSummary, CheckInSource, WeekSummary } from './types'

/** 출근 기록이 어디서 왔는지. 아이콘은 이 크기에서 뭉개지므로 글자로 밝힌다. */
const SOURCE_LABEL: Record<CheckInSource, string> = {
  device: '지문',
  app: '앱',
}

/** 소정 40시간을 넘기면 주의, 52시간에 닿으면 위반. */
function weekTone(week: WeekSummary): 'accent' | 'warning' | 'danger' {
  const total = week.regularMinutes + week.overtimeMinutes
  if (total >= week.limitMinutes) return 'danger'
  if (total >= week.limitMinutes - 7 * 60) return 'warning'
  return 'accent'
}

const BAR_COLOR = {
  accent: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-subtle text-xs">{label}</p>
      <div className="text-fg mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums">
        {children}
      </div>
    </div>
  )
}

function WeekBar({ week }: { week: WeekSummary }) {
  const total = week.regularMinutes + week.overtimeMinutes
  const tone = weekTone(week)
  const percent = Math.min((total / week.limitMinutes) * 100, 100)

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-subtle text-xs">이번 주 누적</p>
        <p className="text-fg text-sm font-semibold tabular-nums">
          {formatMinutes(total)}
          <span className="text-subtle font-normal"> / {formatMinutes(week.limitMinutes)}</span>
        </p>
      </div>

      <div className="bg-sunken h-2 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width]', BAR_COLOR[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-subtle mt-1.5 text-xs">
        소정 {formatMinutes(week.regularMinutes)} · 연장 {formatMinutes(week.overtimeMinutes)}
        {week.unconfirmedDays > 0 && (
          // 설계서 L4 — 기록 없는 근무일을 결근(0분)으로 확정하지 않는다.
          <span className="text-warning"> · 미확정 {week.unconfirmedDays}일</span>
        )}
      </p>
    </div>
  )
}

/**
 * 퇴근 직후에만 뜨는 되돌리기 줄. 유예가 지나면 사라지고 보정 경로만 남는다.
 *
 * 시계가 분 단위라 남은 시간을 내림한다. 마지막 1분 미만 구간에서는 줄이
 * 먼저 사라지는데, 죽은 버튼을 보여주는 것보다 낫다. 경계에서 눌리더라도
 * 서버가 409로 막고 보정을 안내하므로 잘못된 상태는 만들어지지 않는다.
 */
function UndoCheckOutBar({ until, nowMinutes }: { until: string; nowMinutes: number }) {
  const undo = useUndoCheckOut()
  const remaining = Math.floor((new Date(until).getTime() - nowMinutes * 60_000) / 60_000)

  if (remaining <= 0) return null

  return (
    <div className="border-accent/30 bg-accent-soft mx-5 mt-3 rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-fg flex-1 text-sm">
          퇴근으로 기록했습니다.
          <span className="text-muted"> 잘못 눌렀다면 {remaining}분 안에 취소하세요.</span>
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => undo.mutate()}
          disabled={undo.isPending}
        >
          {undo.isPending ? <Spinner /> : <Undo2 className="size-4" />}
          퇴근 취소
        </Button>
      </div>

      {undo.isError && (
        <p role="alert" className="text-danger mt-1.5 text-xs">
          {undo.error instanceof ApiError ? undo.error.message : '취소하지 못했습니다.'}
        </p>
      )}
    </div>
  )
}

function CorrectionBanner({ summary }: { summary: AttendanceSummary }) {
  if (summary.pendingCorrections.length === 0) return null

  return (
    <div className="border-line border-t px-5 py-3">
      {summary.pendingCorrections.map((correction) => (
        <div
          key={correction.date}
          className="text-warning flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            {formatDay(correction.date)}{' '}
            {correction.reason === 'missing_checkout' ? '퇴근' : '출근'} 기록이 없습니다.
          </span>
          <Link to="/attendance" className="text-accent font-medium hover:underline">
            보정 신청
          </Link>
        </div>
      ))}
    </div>
  )
}

function PunchButton({ summary }: { summary: AttendanceSummary }) {
  const checkIn = usePunch('check-in')
  const checkOut = usePunch('check-out')

  if (summary.today.status === 'done') {
    return (
      <Button variant="secondary" disabled>
        오늘 근무 완료
      </Button>
    )
  }

  const isCheckIn = summary.today.status === 'not_checked_in'
  const action = isCheckIn ? checkIn : checkOut

  return (
    <Button onClick={() => action.mutate()} disabled={action.isPending} className="min-w-28">
      {action.isPending ? (
        <Spinner className="border-t-on-accent" />
      ) : (
        <>
          {isCheckIn ? <LogIn className="size-4" /> : <LogOut className="size-4" />}
          {isCheckIn ? '출근하기' : '퇴근하기'}
        </>
      )}
    </Button>
  )
}

export function AttendanceWidget() {
  const { data: summary, isPending, isError } = useAttendanceSummary()
  // 근무 중이면 경과 시간이 흘러야 한다. 1분마다 다시 그린다.
  const nowMinutes = useMinuteClock()

  if (isPending) {
    return (
      <Card className="p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-2 w-full" />
      </Card>
    )
  }

  if (isError || !summary) {
    return (
      <Card className="p-5">
        <p className="text-muted text-sm">근태 정보를 불러오지 못했습니다.</p>
      </Card>
    )
  }

  const { today } = summary
  const source = today.checkInSource ? SOURCE_LABEL[today.checkInSource] : null
  const elapsed =
    today.checkInAt && !today.checkOutAt
      ? nowMinutes - Math.floor(new Date(today.checkInAt).getTime() / 60_000)
      : null

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
        <div>
          <p className="text-subtle text-xs">{formatDay(today.date)} 근태</p>
          <p className="text-fg mt-0.5 text-sm">
            {today.status === 'not_checked_in' && '아직 출근 기록이 없습니다.'}
            {today.status === 'working' &&
              (elapsed !== null ? `${formatMinutes(elapsed)}째 근무 중` : '근무 중')}
            {today.status === 'done' && '오늘 근무가 기록됐습니다.'}
          </p>
        </div>
        <PunchButton summary={summary} />
      </div>

      {today.undoCheckOutUntil && (
        <UndoCheckOutBar until={today.undoCheckOutUntil} nowMinutes={nowMinutes} />
      )}

      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-[auto_auto_1fr] sm:gap-8">
        <Stat label="출근">
          {today.checkInAt ? (
            <>
              {formatTime(today.checkInAt)}
              {source && <Badge>{source}</Badge>}
            </>
          ) : (
            <span className="text-subtle text-base font-normal">미기록</span>
          )}
        </Stat>

        <Stat label="퇴근">
          {today.checkOutAt ? (
            formatTime(today.checkOutAt)
          ) : (
            // 설계서 L1 — 출입 단말은 입장 전용이라 퇴근 기록의 원천이 앱뿐이다.
            <span className="text-subtle text-base font-normal">미기록</span>
          )}
        </Stat>

        <div className="col-span-2 sm:col-span-1">
          <WeekBar week={summary.week} />
        </div>
      </div>

      <CorrectionBanner summary={summary} />
    </Card>
  )
}
