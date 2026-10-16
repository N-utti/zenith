import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { currentMonth, formatMonth, monthMatrix, shiftMonth, toISODate } from '@/lib/datetime'

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
  phone,
  hideHeader,
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
  /** 칸 크기를 바꿀 때. 폰 캘린더는 최소 높이를 풀어 남은 높이를 주 수로 나눠 갖게 한다. */
  dayClassName?: string
  /** 폰 캘린더(/calendar)용. 제목을 왼쪽에 크게(눌러서 달 고르기), 격자는 화면 폭을 다 채운다. */
  phone?: boolean
  /** 머리줄 없이 격자만. 폰 캘린더는 이웃 달 격자를 옆에 나란히 두고 머리줄은 하나만 그린다. */
  hideHeader?: boolean
}) {
  const weeks = monthMatrix(month, weekStartsOn)
  const todayIso = toISODate(new Date())
  const monthIndex = Number(month.split('-')[1]) - 1
  const labels = weekStartsOn === 1 ? WEEKDAYS : [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)]

  return (
    <div className={cn(phone && 'flex min-h-0 flex-col', className)}>
      {!hideHeader && (
        <MonthHeader month={month} onMonthChange={onMonthChange} actions={actions} phone={phone} />
      )}

      {/* 칸 사이 선은 칸마다 그린 왼쪽·위 테두리다. 격자를 1px 당겨 첫 열·첫 줄 테두리는 바깥 상자
          안쪽 경계에서 잘려 안 보인다. 틈(gap-px)에 회색 배경을 비추던 예전 방식은 칸 너비가 소수점이면
          브라우저가 칸을 픽셀에 맞추다 마지막 칸 뒤에 1px 이 남아, 그 회색이 바깥 테두리와 붙어 오른쪽만
          2px 로 보였다(PC 홈 캘린더). 그 1px 틈은 지금도 남을 수 있어서, 줄마다 바탕을 칸이 아니라 격자
          전체에 깐다. 요일 줄은 회색 격자, 날짜 줄은 흰 바깥 상자라 틈이 같은 색으로 묻힌다. */}
      {/* phone: 화면 끝까지 닿는 격자(여백 밖으로 빼는 건 CalendarPage 몫). 둥근 모서리·좌우 테두리와 칸
          사이 세로선은 빼고 주 사이 가로선만 남긴다. 폰 캘린더 앱들(네이버웍스·아이폰)이 이렇게 그린다.
          높이는 남은 자리를 다 쓰고 주 수(4~6)로 똑같이 나눈다. */}
      <div
        className={cn(
          'border-line bg-surface overflow-hidden border',
          phone ? 'flex min-h-0 flex-1 flex-col border-x-0' : 'rounded-lg',
        )}
      >
        <div className={cn('bg-sunken -mt-px grid grid-cols-7', !phone && '-ml-px')}>
          {labels.map((label) => (
            <div
              key={label}
              className={cn(
                'border-line border-t py-1.5 text-center text-xs font-medium',
                !phone && 'border-l',
                // 폰은 한국 달력 관례대로 일요일 빨강·토요일 파랑. PC·근태는 회색 그대로.
                label === '토' || label === '일'
                  ? phone
                    ? label === '일'
                      ? 'text-danger'
                      : 'text-accent'
                    : 'text-subtle'
                  : 'text-muted',
              )}
            >
              {label}
            </div>
          ))}
        </div>
        <div
          className={cn('grid grid-cols-7', phone ? 'min-h-0 flex-1' : '-ml-px')}
          style={
            phone ? { gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` } : undefined
          }
        >
          {weeks.flat().map((date) => {
            const iso = toISODate(date)
            const weekday = date.getDay()
            return (
              <div
                key={iso}
                className={cn(
                  'border-line bg-surface min-h-[76px] border-t p-1.5',
                  !phone && 'border-l',
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
  phone,
}: {
  month: string
  onMonthChange?: (month: string) => void
  actions?: ReactNode
  phone?: boolean
}) {
  // 투명한 달 입력의 초점 고리는 키보드로 들어왔을 때만. 크롬·사파리는 날짜 입력을 눌러도 :focus-visible 로
  // 쳐서, CSS 로만 하면 제목을 누른 뒤 고리가 계속 남는다. Tab 의 keyup 은 새로 초점 받은 입력에서 난다.
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  // 폰(TimeTree 참고): 화살표 없이 왼쪽에 큰 제목. 달은 좌우로 밀어 넘기고(CalendarPage), 제목을 누르면
  // 브라우저 기본 달 고르기(아이폰은 휠)가 뜬다. 투명한 입력을 제목 위에 겹쳐 그 입력이 눌리게 한다.
  // 데스크톱 크롬은 입력의 달력 아이콘이 아니면 안 열려서 showPicker 로 연다.
  if (phone && onMonthChange) {
    return (
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h2 className="relative">
            <label
              className={cn(
                'text-fg flex cursor-pointer items-center gap-1 rounded-md text-xl font-bold whitespace-nowrap',
                keyboardFocus && 'ring-accent ring-2',
              )}
            >
              {formatMonth(month)}
              <ChevronDown className="text-subtle size-5" />
              <input
                type="month"
                value={month}
                aria-label="달 고르기"
                onKeyUp={() => setKeyboardFocus(true)}
                onBlur={() => setKeyboardFocus(false)}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker()
                  } catch {
                    // 아이폰 사파리는 입력을 누른 것만으로 휠이 뜬다.
                  }
                }}
                onChange={(e) => {
                  // 달 입력을 모르는 브라우저(맥 사파리·파이어폭스)는 글자 칸이 되고, 크롬도 키보드로 연도를
                  // 치는 중간에 `0002-10` 같은 값을 낸다. 그대로 넘기면 격자 계산이 깨진다. 범위는 YearHeader 와 같다.
                  const v = e.target.value
                  if (/^\d{4}-\d{2}$/.test(v) && v >= '2000' && v < '2101') onMonthChange(v)
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </h2>
          <button
            type="button"
            onClick={() => onMonthChange(currentMonth())}
            className="border-line text-muted hover:bg-surface-hover hover:text-fg ml-auto rounded-full border px-3 py-1 text-xs font-medium transition-colors"
          >
            오늘
          </button>
        </div>
        {actions && <div className="mt-1 -ml-1.5 flex">{actions}</div>}
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
export function CalendarDayNumber({ day, className }: { day: CalendarDay; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-full text-[13px]',
        day.isToday && 'bg-accent text-on-accent font-semibold',
        !day.isToday && !day.inMonth && 'text-subtle/60',
        !day.isToday && day.inMonth && (day.isWeekend ? 'text-subtle' : 'text-muted'),
        className,
      )}
    >
      {day.date.getDate()}
    </span>
  )
}
