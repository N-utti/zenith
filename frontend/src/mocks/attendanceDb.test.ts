import { describe, expect, it } from 'vitest'
import { toISODate } from '@/lib/datetime'
import { attendanceMonth, attendanceRange } from './attendanceDb'
import { MOCK_USERS } from './db'

const user = MOCK_USERS.find((u) => u.id === 'u-2')!
const month = toISODate(new Date()).slice(0, 7)
const firstOf = `${month}-01`
const lastOf = toISODate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))

describe('기간 집계', () => {
  it('한 달을 통째로 고르면 그 달 집계와 같다', () => {
    // 달 조회와 기간 조회가 다른 숫자를 말하면 어느 쪽을 믿어야 할지 알 수 없다.
    const range = attendanceRange(user, firstOf, lastOf)
    expect(range.summary).toEqual(attendanceMonth(user, month).summary)
    expect(range).toMatchObject({ from: firstOf, to: lastOf })
  })

  it('구간 밖 날짜는 안 센다', () => {
    const whole = attendanceRange(user, firstOf, lastOf).summary
    const head = attendanceRange(user, firstOf, `${month}-01`).summary
    expect(head.worked_days).toBeLessThanOrEqual(whole.worked_days)
  })

  it('달을 넘어가면 달별 집계를 합친 값이다', () => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth = toISODate(prev).slice(0, 7)
    const both = attendanceRange(user, `${prevMonth}-01`, lastOf).summary
    const sum = [prevMonth, month]
      .map((m) => attendanceMonth(user, m).summary)
      .reduce((a, b) => ({
        worked_days: a.worked_days + b.worked_days,
        leave_days: a.leave_days + b.leave_days,
        overtime_minutes: a.overtime_minutes + b.overtime_minutes,
        night_minutes: a.night_minutes + b.night_minutes,
      }))
    expect(both).toEqual(sum)
  })
})
