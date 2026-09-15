import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatMonth, monthMatrix, shiftMonth, toISODate } from '@/lib/datetime'

/** 월요일 시작 기준. `weekStartsOn`을 0으로 주면 앞의 일요일이 뒤로 간다. */
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

export interface CalendarDay {
  date: Date
  /** `2026-08-31`. 서버 키와 같은 형식이라 상태 조회에 그대로 쓴다. */
  iso: string
  /** 보고 있는 달의 날짜인가. 앞뒤 주를 메우는 이웃 달 날짜면 false */
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

/**
 * 월 캘린더. **그리드와 날짜 계산만** 맡는다.
 *
 * 셀 안에 무엇을 그릴지는 `renderDay`가 정한다. 근태(SCR-ATT-01)는 상태 색을 칠하고
 * 휴가 신청(SCR-ATT-02)은 기간을 고르는데, 둘의 공통은 "그 달의 날짜 배치"뿐이다.
 * 여기에 상태나 선택을 넣으면 한쪽 화면 전용 부품이 된다. `MaskedRow`와 같은 이유다.
 *
 * 라이브러리를 쓰지 않은 이유: 필요한 계산이 `monthMatrix` 하나이고, 한국 공휴일은
 * 어떤 라이브러리도 주지 않아 어차피 데이터를 직접 넣어야 한다. 날짜 선택 UI용
 * 라이브러리를 들이면 셀마다 상태 색을 칠하는 쪽과 싸우게 된다.
 *
 * **주 시작은 월요일이 기본이다.** 근무일(월~금)이 갈라지지 않고, 주간 집계
 * (주 40시간 · 연장 12시간 한도)가 월~일 주 단위와 맞는다. 취업규칙이 일요일
 * 시작으로 정해져 있으면 `weekStartsOn={0}`으로 바꾼다 (10 근태 설계서 I4).
 */
export function Calendar({
  month,
  onMonthChange,
  renderDay,
  weekStartsOn = 1,
  actions,
  className,
}: {
  /** `2026-08` */
  month: string
  /** 없으면 이전/다음 버튼을 그리지 않는다 (고정 월 표시용). */
  onMonthChange?: (month: string) => void
  renderDay: (day: CalendarDay) => ReactNode
  weekStartsOn?: 0 | 1
  /** 월 이동 옆에 붙는 것. 범례, "오늘" 버튼 등 */
  actions?: ReactNode
  className?: string
}) {
  const weeks = monthMatrix(month, weekStartsOn)
  const todayIso = toISODate(new Date())
  const monthIndex = Number(month.split('-')[1]) - 1
  const labels = weekStartsOn === 1 ? WEEKDAYS : [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)]

  return (
    <div className={className}>
      <MonthHeader month={month} onMonthChange={onMonthChange} actions={actions} />

      <div className="border-line bg-line overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 gap-px">
          {labels.map((label) => (
            <div
              key={label}
              className={cn(
                'bg-sunken py-1.5 text-center text-xs font-medium',
                label === '토' || label === '일' ? 'text-subtle' : 'text-muted',
              )}
            >
              {label}
            </div>
          ))}

          {weeks.flat().map((date) => {
            const iso = toISODate(date)
            const weekday = date.getDay()
            return (
              <div key={iso} className="bg-surface min-h-[76px] p-1.5">
                {renderDay({
                  date,
                  iso,
                  inMonth: date.getMonth() === monthIndex,
                  isToday: iso === todayIso,
                  isWeekend: weekday === 0 || weekday === 6,
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 월 이동 + 월 제목 줄. 캘린더와 전사 근태 그리드처럼 "한 달"을 보는 화면이 같이 쓴다. */
export function MonthHeader({
  month,
  onMonthChange,
  actions,
}: {
  month: string
  onMonthChange?: (month: string) => void
  actions?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {onMonthChange && (
        <div className="flex items-center gap-0.5">
          <MonthButton label="이전 달" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </MonthButton>
          <MonthButton label="다음 달" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </MonthButton>
        </div>
      )}
      <h2 className="text-fg text-base font-semibold">{formatMonth(month)}</h2>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

function MonthButton({
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

/**
 * 셀 안의 날짜 숫자. `renderDay`가 매번 다시 짜지 않도록 기본 모양을 준다.
 * 이웃 달은 흐리게, 오늘은 채운 원으로. 셋을 색만으로 구분하면 흑백 인쇄에서 사라진다.
 */
export function CalendarDayNumber({ day }: { day: CalendarDay }) {
  return (
    <span
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full text-xs',
        day.isToday && 'bg-accent text-on-accent font-semibold',
        !day.isToday && !day.inMonth && 'text-subtle/60',
        !day.isToday && day.inMonth && (day.isWeekend ? 'text-subtle' : 'text-muted'),
      )}
    >
      {day.date.getDate()}
    </span>
  )
}
