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
  dayClassName,
  spread,
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
  /** 칸 크기를 바꿀 때. 폰 캘린더는 아래 목록을 보이려고 칸을 줄인다. */
  dayClassName?: string
  /** 폰 캘린더용. 화살표를 제목 양옆에 크게 벌리고, 격자는 화면 폭을 다 채운다. */
  spread?: boolean
}) {
  const weeks = monthMatrix(month, weekStartsOn)
  const todayIso = toISODate(new Date())
  const monthIndex = Number(month.split('-')[1]) - 1
  const labels = weekStartsOn === 1 ? WEEKDAYS : [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)]

  return (
    <div className={className}>
      <MonthHeader month={month} onMonthChange={onMonthChange} actions={actions} spread={spread} />

      {/* 칸 사이 선은 칸마다 그린 왼쪽·위 테두리다. 격자를 1px 당겨 첫 열·첫 줄 테두리는 바깥 상자
          안쪽 경계에서 잘려 안 보인다. 틈(gap-px)에 회색 배경을 비추던 예전 방식은 칸 너비가 소수점이면
          브라우저가 칸을 픽셀에 맞추다 마지막 칸 뒤에 1px 이 남아, 그 회색이 바깥 테두리와 붙어 오른쪽만
          2px 로 보였다(PC 홈 캘린더). 그 1px 틈은 지금도 남을 수 있어서, 줄마다 바탕을 칸이 아니라 격자
          전체에 깐다. 요일 줄은 회색 격자, 날짜 줄은 흰 바깥 상자라 틈이 같은 색으로 묻힌다. */}
      {/* spread: 본문 좌우 여백(AppLayout 의 px-4 sm:px-6)만큼 밖으로 빼 화면 끝까지. 화면 끝에 닿는
          둥근 모서리·좌우 테두리와 칸 사이 세로선은 빼고 주 사이 가로선만 남긴다. 폰 캘린더 앱들
          (네이버웍스·아이폰)이 이렇게 그린다. */}
      <div
        className={cn(
          'border-line bg-surface overflow-hidden border',
          spread ? '-mx-4 border-x-0 sm:-mx-6' : 'rounded-lg',
        )}
      >
        <div className={cn('bg-sunken -mt-px grid grid-cols-7', !spread && '-ml-px')}>
          {labels.map((label) => (
            <div
              key={label}
              className={cn(
                'border-line border-t py-1.5 text-center text-xs font-medium',
                !spread && 'border-l',
                label === '토' || label === '일' ? 'text-subtle' : 'text-muted',
              )}
            >
              {label}
            </div>
          ))}
        </div>
        <div className={cn('grid grid-cols-7', !spread && '-ml-px')}>
          {weeks.flat().map((date) => {
            const iso = toISODate(date)
            const weekday = date.getDay()
            return (
              <div
                key={iso}
                className={cn(
                  'border-line bg-surface min-h-[76px] border-t p-1.5',
                  !spread && 'border-l',
                  dayClassName,
                )}
              >
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
  spread,
}: {
  month: string
  onMonthChange?: (month: string) => void
  actions?: ReactNode
  spread?: boolean
}) {
  // 폰: 두 화살표가 붙어 있으면 엄지로 반대쪽을 잘못 누른다. 양 끝에 44px 로 떼어 놓고,
  // 그 줄에 범례까지 넣으면 375px 에서 모자라 범례는 아래 줄로 내린다.
  // -mt-3: 44px 상자 안에서 20px 아이콘이 가운데라 위에 12px 가 더 비어 보인다. 그만큼 당겨
  // 보이는 위 여백을 다른 화면의 본문 시작(페이지 여백 24px)과 맞춘다. 누르는 크기는 그대로.
  if (spread && onMonthChange) {
    return (
      <div className="-mt-3 mb-3">
        <div className="flex items-center justify-between">
          <MonthButton
            label="이전 달"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="grid size-11 place-items-center"
          >
            <ChevronLeft className="size-5" />
          </MonthButton>
          <h2 className="text-fg text-base font-semibold whitespace-nowrap">
            {formatMonth(month)}
          </h2>
          <MonthButton
            label="다음 달"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="grid size-11 place-items-center"
          >
            <ChevronRight className="size-5" />
          </MonthButton>
        </div>
        {actions && <div className="flex justify-center">{actions}</div>}
      </div>
    )
  }

  return (
    // flex-wrap: 범례가 붙는 화면(홈)에서 375px 에 한 줄로 다 못 들어간다. 안 접으면
    // 제목이 "2026년 9 / 월" 로 쪼개진다. 접히면 범례만 다음 줄로 내려간다.
    <div className="mb-3 flex flex-wrap items-center gap-2">
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
      <h2 className="text-fg text-base font-semibold whitespace-nowrap">{formatMonth(month)}</h2>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** 연도 이동 + 연도 제목 줄. 월 마감·휴일 설정처럼 "한 해"를 보는 화면이 같이 쓴다. 2000~2100 안. */
export function YearHeader({
  year,
  onYearChange,
  actions,
}: {
  year: number
  onYearChange: (year: number) => void
  actions?: ReactNode
}) {
  return (
    // MonthHeader 와 같은 이유로 접는다. 여기 곁가지는 더 무겁다(휴일 설정은 설명문 두 줄 +
    // 버튼). 안 접으면 좁은 폭에서 「2026 / 년」으로 쪼개진다.
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5">
        <MonthButton label="이전 해" onClick={() => onYearChange(Math.max(2000, year - 1))}>
          <ChevronLeft className="size-4" />
        </MonthButton>
        <MonthButton label="다음 해" onClick={() => onYearChange(Math.min(2100, year + 1))}>
          <ChevronRight className="size-4" />
        </MonthButton>
      </div>
      <h2 className="text-fg text-base font-semibold whitespace-nowrap">{year}년</h2>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

function MonthButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'text-muted hover:bg-surface-hover hover:text-fg rounded-md p-1.5 transition-colors',
        className,
      )}
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
        'inline-flex size-6 items-center justify-center rounded-full text-[13px]',
        day.isToday && 'bg-accent text-on-accent font-semibold',
        !day.isToday && !day.inMonth && 'text-subtle/60',
        !day.isToday && day.inMonth && (day.isWeekend ? 'text-subtle' : 'text-muted'),
      )}
    >
      {day.date.getDate()}
    </span>
  )
}
