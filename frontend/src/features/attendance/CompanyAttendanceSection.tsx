import { useState } from 'react'
import { MonthHeader } from '@/components/ui/Calendar'
import { Card } from '@/components/ui/Card'
import { TableEmpty } from '@/components/ui/Table'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { currentMonth, formatISODate, formatMonth, toISODate } from '@/lib/datetime'
import { ROLE_LABEL } from '@/types'
import { useCompanyAttendance } from './api'
import { AttendanceLegend } from './AttendanceLegend'
import {
  cellStatus,
  formatMinutes,
  indexByDate,
  STATUS_TONE,
  type CellStatus,
} from './attendanceDays'
import { ATTENDANCE_STATUS_LABEL, type AttendanceGridRow } from './types'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 칸이 좁아 한 글자만. 정상은 비우고, 주말·휴일은 글자 없이 옅은 회색만 깐다.
 * 휴일에 '휴'를 쓰면 휴가와 색으로만 갈려서 뺐다. 읽기용 라벨(sr-only)에는 "휴일"이 남는다.
 */
const SHORT: Partial<Record<CellStatus, string>> = {
  leave: '휴',
  half_leave: '반',
  remote: '재',
  field: '외',
  trip: '출',
  absent: '결',
}

interface GridDay {
  iso: string
  day: number
  weekday: number
}

/** `2026-09` 의 날짜 전부. 요일은 열 머리에 쓴다. */
function daysOf(month: string): GridDay[] {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => {
    const date = new Date(year, m - 1, i + 1)
    return { iso: toISODate(date), day: i + 1, weekday: date.getDay() }
  })
}

/**
 * 전사 근태(임원): 직원 × 일자 상태 그리드 + 범례 + 사람별 연장근로 누계(05 의 팀 근태 현황을 전사로).
 * 사유는 싣지 않는다. 병가 사유 같은 민감정보는 본인과 결재선만 본다(10 §8), 그리드에는 종류만.
 *
 * 공용 `Table` 을 안 쓴 이유: 그 래퍼는 포커스를 못 받아 키보드로 가로 스크롤이 안 되고,
 * `TH` 는 `scope="col"` 고정이라 이름 열(행 머리)을 못 만든다. 빈 상태 행(`TableEmpty`)만 가져다 쓴다.
 */
export function CompanyAttendanceSection() {
  const [month, setMonth] = useState(currentMonth)
  const grid = useCompanyAttendance(month)
  const days = daysOf(month)
  const rows = grid.data?.items ?? []
  const span = days.length + 2

  return (
    <Card className="p-4">
      <MonthHeader
        month={month}
        onMonthChange={setMonth}
        actions={<AttendanceLegend className="hidden sm:flex" />}
      />
      {/* 본문 폭(최대 1152px)에 31칸이 들어가게 칸 최소폭을 두지 않는다. 좁은 창에서만 구르고,
          안에 포커스 받을 요소가 없으니 그때는 영역 자체가 받아야 키보드로도 넘긴다. */}
      <div
        tabIndex={0}
        role="region"
        aria-label={`${formatMonth(month)} 전사 근태 표`}
        className={cn(
          'border-line focus-visible:ring-accent overflow-x-auto rounded-lg border focus-visible:ring-2 focus-visible:outline-none',
          grid.isPending && 'animate-pulse opacity-60',
        )}
      >
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">{formatMonth(month)} 전사 근태</caption>
          <thead className="bg-sunken">
            <tr>
              {/* 이름 열은 가로로 굴러도 고정. 31칸을 넘기다 보면 누구 줄인지 잊는다. */}
              <th
                scope="col"
                className="bg-sunken text-muted border-line sticky left-0 z-10 border-r px-3 py-2 text-left font-semibold"
              >
                이름
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  scope="col"
                  title={formatISODate(d.iso)}
                  className={cn(
                    'px-0.5 py-1.5 text-center font-normal tabular-nums',
                    d.weekday === 0 || d.weekday === 6 ? 'text-subtle' : 'text-muted',
                  )}
                >
                  <div>{d.day}</div>
                  <div className="text-[10px]">{WEEKDAY[d.weekday]}</div>
                </th>
              ))}
              <th
                scope="col"
                className="text-muted px-3 py-2 text-right font-semibold whitespace-nowrap"
              >
                연장
                {/* 실근로시간을 재지 않는다. 신고분만 담긴 값이라 라벨 없이는 실측처럼 읽힌다(10 §5.3). */}
                <div className="text-subtle text-[10px] font-normal">승인 신고 기준</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* 달을 넘길 때는 이전 달 표가 남아 있어(keepPreviousData) 첫 진입에만 보인다. */}
            {grid.isPending && <TableEmpty colSpan={span}>불러오는 중</TableEmpty>}
            {grid.isError && (
              <TableEmpty colSpan={span}>
                {grid.error instanceof ApiError
                  ? grid.error.message
                  : '전사 근태를 불러오지 못했습니다.'}
              </TableEmpty>
            )}
            {grid.data && rows.length === 0 && (
              <TableEmpty colSpan={span}>직원이 없습니다.</TableEmpty>
            )}
            {rows.map((row) => (
              <GridRow key={row.user.id} row={row} days={days} />
            ))}
          </tbody>
        </table>
      </div>
      <AttendanceLegend className="mt-3 flex sm:hidden" />
    </Card>
  )
}

function GridRow({ row, days }: { row: AttendanceGridRow; days: GridDay[] }) {
  const byDate = indexByDate(row.days)
  // 임원은 팀이 없다(조직도). 그 외에 팀이 비면 등급을 소속인 양 쓰지 않고 그냥 이름만.
  const team = row.user.team?.name ?? (row.user.role === 'exec' ? ROLE_LABEL.exec : '')
  return (
    <tr className="border-line border-t">
      <th
        scope="row"
        className="bg-surface text-fg border-line sticky left-0 z-10 border-r px-3 py-1.5 text-left font-medium whitespace-nowrap"
      >
        {row.user.name}
        {team && <span className="text-subtle ml-1.5 font-normal">{team}</span>}
      </th>
      {days.map((d) => {
        const status = cellStatus(byDate, {
          iso: d.iso,
          isWeekend: d.weekday === 0 || d.weekday === 6,
          inMonth: true,
        })
        const tone = STATUS_TONE[status]
        const cell = byDate.get(d.iso)
        const label = status === 'none' ? null : ATTENDANCE_STATUS_LABEL[status]
        const title = [
          formatISODate(d.iso),
          label,
          cell && cell.overtime_minutes > 0 && `연장 ${formatMinutes(cell.overtime_minutes)}`,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <td key={d.iso} title={title} className="p-0.5 text-center">
            {/* 글자가 없는 칸도 같은 높이여야 한 줄이 맞는다. 빈 블록은 줄상자가 없어 leading 이 안 먹는다. */}
            <span
              className={cn(
                'block h-6 rounded leading-6',
                tone ?? (status === 'none' ? 'bg-sunken/60' : ''),
              )}
            >
              {/* 보이는 한 글자는 소리에서 빼고 전체 라벨만 읽힌다. 안 그러면 "휴 휴가"로 두 번 읽는다. */}
              <span aria-hidden="true">{SHORT[status]}</span>
              {label && <span className="sr-only">{label}</span>}
            </span>
          </td>
        )
      })}
      <td className="text-muted px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
        {row.summary.overtime_minutes > 0 ? formatMinutes(row.summary.overtime_minutes) : '-'}
      </td>
    </tr>
  )
}
