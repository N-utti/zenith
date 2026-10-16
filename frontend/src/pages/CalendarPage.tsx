import { useState } from 'react'
import { Calendar, CalendarDayNumber } from '@/components/ui/Calendar'
import { CardEmpty } from '@/components/ui/Card'
import { DayAgenda, Legend } from '@/features/home/CalendarCard'
import { DOT, MAX_CHIPS, WEEK_STARTS_ON, useCalendarItems } from '@/features/home/useCalendarItems'
import { cn } from '@/lib/cn'
import { currentMonth, formatISODate, toISODate } from '@/lib/datetime'

/**
 * 폰 하단 탭의 캘린더. 네이버웍스 모바일처럼 위는 작은 월 달력, 아래는 고른 날의 목록이다.
 * PC 는 홈 캘린더 카드가 이 일을 한다(사이드바에 메뉴 없음). 주소로 들어와도 같은 화면이 뜬다.
 */
export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState(() => toISODate(new Date()))
  const { days, show, toggle, isError, isPending, retry } = useCalendarItems(month)

  // 달을 넘기면 고른 날도 따라간다. 안 그러면 격자 밖 날짜의 빈 목록이 아래 남는다.
  const changeMonth = (next: string) => {
    setMonth(next)
    setSelected(next === currentMonth() ? toISODate(new Date()) : `${next}-01`)
  }

  return (
    <>
      <h1 className="sr-only">캘린더</h1>
      {isError && <CardEmpty onRetry={retry}>일정을 불러오지 못했습니다.</CardEmpty>}
      <Calendar
        month={month}
        onMonthChange={changeMonth}
        weekStartsOn={WEEK_STARTS_ON}
        actions={<Legend show={show} onToggle={toggle} />}
        className={cn(isPending && 'animate-pulse opacity-60')}
        dayClassName="min-h-12 p-0.5"
        renderDay={(day) => {
          const items = days.get(day.iso) ?? []
          const isSelected = day.iso === selected
          return (
            <button
              type="button"
              onClick={() => setSelected(day.iso)}
              aria-pressed={isSelected}
              aria-label={`${formatISODate(day.iso)} 일정 ${items.length}건`}
              className={cn(
                'flex h-full w-full flex-col items-center gap-1 rounded-md pt-0.5 transition-colors',
                isSelected ? 'bg-accent-soft' : 'hover:bg-surface-hover',
                !day.inMonth && 'opacity-60',
              )}
            >
              <CalendarDayNumber day={day} />
              {items.length > 0 && (
                <span className="flex gap-0.5">
                  {items.slice(0, MAX_CHIPS).map((item) => (
                    <span key={item.id} className={cn('size-1.5 rounded-full', DOT[item.group])} />
                  ))}
                </span>
              )}
            </button>
          )
        }}
      />

      <section className="mt-5">
        <h2 className="text-fg mb-3 text-sm font-semibold">{formatISODate(selected)}</h2>
        {/* 고른 날이 바뀌면 쓰던 입력을 비운다. 다른 날에 잘못 들어가지 않게. */}
        <DayAgenda key={selected} iso={selected} items={days.get(selected) ?? []} />
      </section>
    </>
  )
}
