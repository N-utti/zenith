import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Plus } from 'lucide-react'
import {
  Calendar,
  CalendarDayNumber,
  MonthHeader,
  type CalendarDay,
} from '@/components/ui/Calendar'
import { CardEmpty } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { DayAgenda, Legend } from '@/features/home/CalendarCard'
import type { CalendarGroup, CalendarItem } from '@/features/home/calendarItems'
import {
  DOT,
  MAX_CHIPS,
  TONE,
  WEEK_STARTS_ON,
  useCalendarDays,
  useCalendarShow,
} from '@/features/home/useCalendarItems'
import { cn } from '@/lib/cn'
import { currentMonth, formatISODate, shiftMonth, toISODate } from '@/lib/datetime'
import { swipeStep } from '@/lib/swipe'

/**
 * 칸 안 칩 색. TimeTree 처럼 종일(휴가·예외 근무·시각 없는 일정)은 진한 바탕에 흰 글자, 시각이 있는
 * 일정은 연한 바탕에 색 글자. 글자는 짧은 이름(`short`)이고 전체 문구·시각은 날짜 창에서 본다.
 */
function chipTone(item: CalendarItem) {
  const timed = item.kind === 'event' && item.event.time
  return timed ? TONE[item.group] : cn(DOT[item.group], 'text-on-accent')
}

/** 일요일 빨강·토요일 파랑. 오늘(채운 원)과 이웃 달(흐림)은 원래 색. */
function weekendTone(day: CalendarDay) {
  if (day.isToday || !day.inMonth) return undefined
  const weekday = day.date.getDay()
  return weekday === 0 ? 'text-danger' : weekday === 6 ? 'text-accent' : undefined
}

/** 넘길 때 옆 달이 가운데로 들어오는 시간. */
const SLIDE_MS = 220

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** 한 달 격자. 가운데(보는 달)와 양옆(이웃 달)에 하나씩, 셋이 나란히 놓인다. */
function MonthPane({
  month,
  show,
  openIso,
  onOpen,
}: {
  month: string
  show: Record<CalendarGroup, boolean>
  openIso: string | null
  onOpen: (iso: string) => void
}) {
  const { days, isPending } = useCalendarDays(month, show)
  return (
    <Calendar
      month={month}
      weekStartsOn={WEEK_STARTS_ON}
      phone
      hideHeader
      className={cn('min-h-0 flex-1', isPending && 'animate-pulse opacity-60')}
      // 칸 높이는 화면이 정한다. 짧은 폰에서 칸이 낮아지면 칩은 들어가는 만큼만 보이고 나머지는 날짜 창에서.
      dayClassName="min-h-0 overflow-hidden p-0.5"
      renderDay={(day) => {
        const items = days.get(day.iso) ?? []
        return (
          <button
            type="button"
            onClick={() => onOpen(day.iso)}
            aria-label={`${formatISODate(day.iso)} 일정 ${items.length}건`}
            className={cn(
              'flex h-full w-full flex-col items-center gap-0.5 rounded-md pt-0.5 transition-colors',
              openIso === day.iso ? 'bg-accent-soft' : 'hover:bg-surface-hover',
              !day.inMonth && 'opacity-60',
            )}
          >
            <CalendarDayNumber day={day} className={weekendTone(day)} />
            {items.slice(0, MAX_CHIPS).map((item) => (
              <span
                key={item.id}
                className={cn(
                  'w-full truncate rounded-sm px-0.5 text-left text-[11px] leading-4',
                  chipTone(item),
                )}
              >
                {item.short}
              </span>
            ))}
            {items.length > MAX_CHIPS && (
              <span className="text-subtle text-[11px] leading-4">+{items.length - MAX_CHIPS}</span>
            )}
          </button>
        )
      }}
    />
  )
}

/**
 * 폰 하단 탭의 캘린더. TimeTree 처럼 달력이 화면을 채우고 칸에 일정 이름이 보인다. 날짜를 누르면
 * 아래에서 그날 목록과 내 일정 추가가 올라온다. 오른쪽 아래 + 는 오늘(다른 달을 보고 있으면 그 달 1일).
 * PC 는 홈 캘린더 카드가 이 일을 한다(사이드바에 메뉴 없음). 주소로 들어와도 같은 화면이 뜬다.
 */
export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth)
  // 열린 날짜 창. adding 은 + 버튼으로 열었을 때라 추가 칸에 바로 초점을 준다.
  const [open, setOpen] = useState<{ iso: string; adding: boolean } | null>(null)
  const { show, toggle } = useCalendarShow()
  // 가운데 격자도 같은 조회를 쓴다(react-query 가 한 번만 받는다). 여기서는 날짜 창 목록과 오류 안내용.
  const { days, isError, retry } = useCalendarDays(month, show)
  const track = useRef<HTMLDivElement>(null)
  // 끌기 상태. axis 는 처음 8px 를 움직인 방향으로 정한다. 세로로 시작한 손짓은 따라가지 않는다.
  const drag = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  // 넘기는 중인 애니메이션. 끝나기 전에 다음 손짓이 오면 바로 마치고 새로 시작한다.
  const sliding = useRef<{ timer: number; step: -1 | 1 } | null>(null)

  // 세 장 띠를 옮긴다. 기본 자리(가운데 달)는 클래스의 -translate-x-full 이고, 여기서는 그만큼에서 더 민다.
  // 다시 그리지 않고 style 을 바로 고쳐 손가락을 매 프레임 따라간다.
  const moveTrack = (px: number, ms = 0) => {
    const el = track.current
    if (!el) return
    el.style.transition = ms ? `transform ${ms}ms ease-out` : 'none'
    el.style.transform = px ? `translateX(${px}px)` : ''
  }

  // 옆 달이 가운데 자리에 다 들어온 순간 달을 바꾸고 띠를 기본 자리로 돌린다. 달 바꾸기를 flushSync 로
  // 먼저 그려야 한다. 띠만 먼저 돌아가면 한 프레임 동안 지난 달이 가운데에 비친다.
  const finishSlide = () => {
    const s = sliding.current
    if (!s) return
    clearTimeout(s.timer)
    sliding.current = null
    flushSync(() => setMonth((m) => shiftMonth(m, s.step)))
    moveTrack(0)
  }

  const slideTo = (step: -1 | 1) => {
    const width = track.current?.offsetWidth ?? 0
    if (!width || reducedMotion()) {
      moveTrack(0)
      setMonth((m) => shiftMonth(m, step))
      return
    }
    moveTrack(-step * width, SLIDE_MS)
    sliding.current = { step, timer: window.setTimeout(finishSlide, SLIDE_MS) }
  }

  const addDay = month === currentMonth() ? toISODate(new Date()) : `${month}-01`
  const openDay = (iso: string) => setOpen({ iso, adding: false })

  return (
    // 본문 패딩 없는 레이아웃(bleed)이라 여백을 여기서 준다. 높이는 본문 칸에 꼭 맞고 스크롤이 없다.
    // touch-action: 세로 끌기를 브라우저에 넘기지 않는다. 옆으로 밀 때 섞인 세로 움직임을 아이폰 사파리가
    // 화면 튕김으로 받아 전체가 위아래로 출렁였다(실기기, 사용자 확인). 굴릴 것이 없는 화면이라 잃는 게
    // 없다. 확대(두 손가락)는 남긴다. 안쪽에도 거는 건 칸·칩의 overflow-hidden 이 스크롤 칸이라 거기서
    // 판정이 끊길 수 있어서다(문서 패널 바텀시트 때와 같은 이유). 날짜 창은 포털이라 영향이 없다.
    <div className="relative flex h-full touch-pan-x touch-pinch-zoom flex-col px-4 pt-6 pb-0 sm:px-6 [&_*]:touch-pan-x [&_*]:touch-pinch-zoom">
      <h1 className="sr-only">캘린더</h1>
      {isError && (
        <div className="mb-3 shrink-0">
          <CardEmpty onRetry={retry}>일정을 불러오지 못했습니다.</CardEmpty>
        </div>
      )}
      <MonthHeader
        month={month}
        onMonthChange={setMonth}
        actions={<Legend show={show} onToggle={toggle} />}
        phone
      />
      {/* 달력을 좌우로 밀면 달이 넘어간다. 화살표가 없어 이게 주된 길이고, 멀리 갈 때는 제목을 누른다.
          지난달·이번 달·다음 달 격자를 나란히 두고 띠째 손가락을 따라 옮겨, 밀자마자 옆 달이 붙어 나온다.
          덜 밀고 놓으면 제자리로 돌아간다. 날짜 누르기는 그대로 산다(손가락이 움직이면 누름이 안 간다).
          본문 여백 밖으로 빼 화면 끝까지 닿게 하고, 옆 달은 그 바깥이라 잘려 안 보인다. */}
      <div
        className="-mx-4 flex min-h-0 flex-1 overflow-hidden sm:-mx-6"
        onTouchStart={(e) => {
          finishSlide()
          if (e.touches.length !== 1) {
            // 끄는 중에 두 번째 손가락이 닿았다(확대). 옮겨 둔 띠를 제자리로.
            if (drag.current?.axis === 'x') moveTrack(0, 200)
            drag.current = null
            return
          }
          const t = e.touches[0]
          drag.current = { x: t.clientX, y: t.clientY, axis: null }
        }}
        onTouchMove={(e) => {
          const d = drag.current
          if (!d) return
          const t = e.touches[0]
          const dx = t.clientX - d.x
          const dy = t.clientY - d.y
          if (!d.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
            d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
          }
          if (d.axis === 'x' && !reducedMotion()) moveTrack(dx)
        }}
        onTouchEnd={(e) => {
          const d = drag.current
          drag.current = null
          if (!d) return
          const t = e.changedTouches[0]
          const step = d.axis === 'x' ? swipeStep(t.clientX - d.x, t.clientY - d.y) : 0
          if (step) slideTo(step)
          else if (d.axis === 'x') moveTrack(0, 200)
        }}
        onTouchCancel={() => {
          drag.current = null
          moveTrack(0, 200)
        }}
      >
        <div ref={track} className="flex w-full -translate-x-full">
          {[-1, 0, 1].map((offset) => {
            const m = shiftMonth(month, offset)
            return (
              // 이웃 달은 화면 밖이라 누를 수도 읽힐 수도 없게 한다.
              <div key={m} className="flex w-full shrink-0 flex-col" inert={offset !== 0}>
                <MonthPane month={m} show={show} openIso={open?.iso ?? null} onOpen={openDay} />
              </div>
            )
          })}
        </div>
      </div>

      {/* 날짜 창은 밀기 영역 밖에 둔다. 모달은 포털이지만 React 이벤트는 컴포넌트 트리로 올라와서, 안에
          두면 창 안에서 옆으로 민 것이 뒤 달력을 넘긴다. */}
      {open && (
        <Modal open sheet size="sm" title={formatISODate(open.iso)} onClose={() => setOpen(null)}>
          <DayAgenda
            key={open.iso}
            iso={open.iso}
            items={days.get(open.iso) ?? []}
            autoFocus={open.adding}
          />
        </Modal>
      )}

      {/* 화면(본문 칸) 오른쪽 아래에 달력 위로 뜬다. */}
      <button
        type="button"
        aria-label={`${formatISODate(addDay)} 일정 추가`}
        onClick={() => setOpen({ iso: addDay, adding: true })}
        className="bg-accent text-on-accent absolute right-4 bottom-4 grid size-14 place-items-center rounded-full shadow-lg transition-transform active:scale-95"
      >
        <Plus className="size-6" />
      </button>
    </div>
  )
}
