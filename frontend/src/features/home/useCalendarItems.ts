import { useState } from 'react'
import { useAllArrangements, useAllLeaves, useLeaveTypes } from '@/features/attendance/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { monthMatrix, toISODate } from '@/lib/datetime'
import { useMyEvents } from './api'
import { itemsByDay, onlyShown, type CalendarGroup } from './calendarItems'

/**
 * 동료는 파랑(accent) 하나, 개인은 초록. 부재의 종류(휴가·재택·외근·출장)는 색으로 가르지 않는다.
 * 05 의 상태 색 규약(휴가 파랑 / 예외 근무 청록)은 근태 캘린더 몫이고, 홈은 "자리에 없다"만 보면 된다.
 */
export const TONE: Record<CalendarGroup, string> = {
  colleague: 'bg-accent-soft text-accent',
  personal: 'bg-success/12 text-success',
}

/** 진한 색. 켜진 범례 견본, 날짜 창 목록의 견본, 폰 칸의 종일 칩 바탕. 작은 견본은 연한 색으로는 안 보인다. */
export const DOT: Record<CalendarGroup, string> = {
  colleague: 'bg-accent',
  personal: 'bg-success',
}

/** 칸 하나에 보이는 최대 줄 수. 넘치면 "+N" 으로 접고 눌러서 본다. */
export const MAX_CHIPS = 3

/**
 * 홈 캘린더·폰 캘린더의 주 시작. 조회 기간과 격자가 같은 값을 봐야 한다. 일요일(2026-10-16 사용자 결정,
 * 흔한 달력 모양). 근태 달력은 주 40시간 집계가 월~일 주라 월요일 그대로다(`Calendar` 기본값).
 */
export const WEEK_STARTS_ON = 0

const SHOW_KEY = 'zenith.calendarShow'

/**
 * 범례 토글 상태. 처음엔 개인만 켠다(사용자 결정). 사이드바 구획 접기처럼 브라우저에 남긴다. 홈 카드는
 * 홈에 들어올 때마다 다시 그려져서, 컴포넌트 상태만으로는 켜 둔 동료가 매번 꺼진다.
 */
function readShow(): Record<CalendarGroup, boolean> {
  const show = { personal: true, colleague: false }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SHOW_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      for (const group of ['personal', 'colleague'] as const) {
        const v = (raw as Record<string, unknown>)[group]
        if (typeof v === 'boolean') show[group] = v
      }
    }
  } catch {
    // 깨진 값이면 기본값.
  }
  return show
}

/** 범례 토글. 폰 캘린더는 나란히 그린 세 달 격자가 이 상태 하나를 같이 쓴다. */
export function useCalendarShow() {
  const [show, setShow] = useState(readShow)
  const toggle = (group: CalendarGroup) => {
    const next = { ...show, [group]: !show[group] }
    setShow(next)
    try {
      localStorage.setItem(SHOW_KEY, JSON.stringify(next))
    } catch {
      // 저장 못 해도 이번 화면의 토글은 유지된다.
    }
  }
  return { show, toggle }
}

/**
 * 한 달 격자에 그릴 항목. 전 직원의 승인된 휴가·재택·외근·출장 + 내 개인 일정에서 `show` 로 켠 묶음만.
 */
export function useCalendarDays(month: string, show: Record<CalendarGroup, boolean>) {
  const me = useCurrentUser()

  // 보이는 칸(이웃 달 포함) 전체를 한 번에 묻는다. 달력에 빈 칸이 없어야 한다.
  const weeks = monthMatrix(month, WEEK_STARTS_ON)
  const range = {
    from: toISODate(weeks[0][0]),
    to: toISODate(weeks[weeks.length - 1][6]),
  }
  const leaves = useAllLeaves(range.from, range.to)
  const arrangements = useAllArrangements(range.from, range.to)
  const events = useMyEvents(range.from, range.to)
  const types = useLeaveTypes()
  // 남의 휴가는 종류를 가려 `leave` 로 온다(병가·경조사는 알릴 일이 아니다, 백엔드 #316). 목록에 없는
  // 종류는 그냥 휴가로 보인다.
  const typeName = (code: string) => types.data?.items.find((t) => t.code === code)?.name ?? '휴가'
  const isError = leaves.isError || arrangements.isError || events.isError
  const retry = () =>
    Promise.all([leaves, arrangements, events].filter((q) => q.isError).map((q) => q.refetch()))
  const isPending = leaves.isPending || arrangements.isPending || events.isPending

  const all = itemsByDay(
    leaves.data?.items ?? [],
    events.data?.items ?? [],
    typeName,
    range,
    arrangements.data?.items ?? [],
    me.id,
  )
  const days = onlyShown(all, show)
  return { days, isError, isPending, retry }
}

/** 한 달 격자에 그릴 항목과 범례 토글. 홈 카드가 쓴다. */
export function useCalendarItems(month: string) {
  const { show, toggle } = useCalendarShow()
  return { ...useCalendarDays(month, show), show, toggle }
}
