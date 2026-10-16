import { useState } from 'react'
import { useAllArrangements, useAllLeaves, useLeaveTypes } from '@/features/attendance/api'
import { monthMatrix, toISODate } from '@/lib/datetime'
import { useMyEvents } from './api'
import { itemsByDay, type CalendarItem } from './calendarItems'

/**
 * 부재(휴가·재택·외근·출장)는 파랑(accent) 하나, 내 일정은 초록. 홈에서는 종류를 색으로 가르지 않는다.
 * 05 의 상태 색 규약(휴가 파랑 / 예외 근무 청록)은 근태 캘린더 몫이고, 홈은 "자리에 없다"만 보면 된다.
 */
export const TONE: Record<CalendarItem['kind'], string> = {
  absence: 'bg-accent-soft text-accent',
  event: 'bg-success/12 text-success',
}

/** 진한 색. 폰 칸의 점과 켜진 범례 견본. 점은 작아서 칩의 연한 색으로는 안 보인다. */
export const DOT: Record<CalendarItem['kind'], string> = {
  absence: 'bg-accent',
  event: 'bg-success',
}

/** 칸 하나에 보이는 최대 줄 수. 넘치면 "+N" 으로 접고 눌러서 본다. */
export const MAX_CHIPS = 3

/** 조회 기간과 격자가 같은 주 시작을 봐야 한다. 취업규칙이 일요일 시작이면 여기만 0 으로. */
export const WEEK_STARTS_ON = 1

/**
 * 한 달 격자에 그릴 항목과 범례 토글. 홈 카드와 폰 캘린더 화면(`/calendar`)이 같이 쓴다.
 * 전 직원의 승인된 휴가·재택·외근·출장 + 내 개인 일정.
 */
export function useCalendarItems(month: string) {
  // 범례를 눌러 종류별로 끈다. 휴가만 보거나 내 일정만 보거나.
  const [show, setShow] = useState<Record<CalendarItem['kind'], boolean>>({
    absence: true,
    event: true,
  })
  const toggle = (kind: CalendarItem['kind']) => setShow((s) => ({ ...s, [kind]: !s[kind] }))

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

  const days = itemsByDay(
    (show.absence && leaves.data?.items) || [],
    (show.event && events.data?.items) || [],
    typeName,
    range,
    (show.absence && arrangements.data?.items) || [],
  )
  return { days, show, toggle, isError, isPending, retry }
}
