import type { CalendarEvent, CalendarEventInput } from '@/features/home/types'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { ISO_DATE } from './leavesDb'

const events = new Map<string, CalendarEvent[]>()
let seq = 1

function daysFromNow(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return toISODate(date)
}

function listFor(user: User): CalendarEvent[] {
  let list = events.get(user.id)
  if (!list) {
    // 첫 진입에 오늘 언저리 일정 몇 개. 빈 캘린더는 기능이 있는지도 모른다.
    const at = (offset: number, title: string, time: string | null): CalendarEvent => ({
      id: `ev-${seq++}`,
      date: daysFromNow(offset),
      title,
      time,
      created_at: new Date().toISOString(),
    })
    list = [at(0, '주간 회의', '10:00'), at(1, '치과 예약', '14:30'), at(4, '보고서 마감', null)]
    events.set(user.id, list)
  }
  return list
}

export function listEvents(user: User, from: string, to: string): CalendarEvent[] {
  return listFor(user).filter((e) => e.date >= from && e.date <= to)
}

const TIME = /^\d{2}:\d{2}$/

export function createEvent(
  user: User,
  input: CalendarEventInput,
): { event: CalendarEvent } | { error: string } {
  const title = input.title?.trim() ?? ''
  if (!title || title.length > 200) return { error: '제목은 1~200자입니다.' }
  if (!ISO_DATE.test(input.date ?? '')) return { error: '날짜가 올바르지 않습니다.' }
  const time = input.time || null
  if (time && !TIME.test(time)) return { error: '시각이 올바르지 않습니다.' }
  const event: CalendarEvent = {
    id: `ev-${seq++}`,
    date: input.date,
    title,
    time,
    created_at: new Date().toISOString(),
  }
  listFor(user).push(event)
  return { event }
}

/** 본인 것만 지운다(남의 id 는 04 §2 todos 와 같이 404). */
export function deleteEvent(user: User, id: string): boolean {
  const list = listFor(user)
  const index = list.findIndex((e) => e.id === id)
  if (index < 0) return false
  list.splice(index, 1)
  return true
}
