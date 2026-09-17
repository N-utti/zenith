import { describe, expect, it } from 'vitest'
import { toISODate } from '@/lib/datetime'
import { attendanceMonth, attendanceRange, workdaysInYear } from './attendanceDb'
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

  it('구간을 둘로 쪼개 더하면 전체와 같다', () => {
    /*
     * 구간 밖 날짜를 거르는 줄에 실제로 거는 그물이다. 그 줄을 지우면 두 조각이 각각 달 전체를
     * 세어 합이 두 배가 된다. "한쪽이 전체보다 작거나 같다" 로는 지워도 통과해 아무것도 못 막는다.
     */
    const days = attendanceMonth(user, month).days
    const mid = Math.floor(days.length / 2)
    const cut = days[mid].work_date
    const next = days[mid + 1].work_date

    const whole = attendanceRange(user, firstOf, lastOf).summary
    const head = attendanceRange(user, firstOf, cut).summary
    const tail = attendanceRange(user, next, lastOf).summary

    expect(head.worked_days + tail.worked_days).toBe(whole.worked_days)
    expect(head.leave_days + tail.leave_days).toBe(whole.leave_days)
    expect(head.overtime_minutes + tail.overtime_minutes).toBe(whole.overtime_minutes)
    expect(head.night_minutes + tail.night_minutes).toBe(whole.night_minutes)
  })

  it('하루만 고르면 그 하루만 센다', () => {
    const days = attendanceMonth(user, month).days
    const one = days[0]
    const summary = attendanceRange(user, one.work_date, one.work_date).summary
    expect(summary.overtime_minutes).toBe(one.overtime_minutes)
    expect(summary.night_minutes).toBe(one.night_minutes)
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

  it('기본 구간(올해 1월 1일부터 이번 달 말일까지)이 이번 달을 통째로 담는다', () => {
    // 화면이 처음 보여 주는 구간이다. 여기가 이번 달을 자르면 바로 위 달력과 휴가 숫자가 갈린다.
    const yearStart = `${new Date().getFullYear()}-01-01`
    const ytd = attendanceRange(user, yearStart, lastOf).summary
    const thisMonth = attendanceMonth(user, month).summary
    expect(ytd.leave_days).toBeGreaterThanOrEqual(thisMonth.leave_days)
    expect(ytd.overtime_minutes).toBeGreaterThanOrEqual(thisMonth.overtime_minutes)
  })
})

describe('근무 달력 재생성', () => {
  it('주말과 휴일을 뺀 근무일 수를 센다', () => {
    const year = Number(month.slice(0, 4))
    const byMonth = Array.from({ length: 12 }, (_, i) =>
      attendanceMonth(user, `${year}-${String(i + 1).padStart(2, '0')}`),
    ).reduce((sum, m) => sum + m.days.length, 0)

    // 달력 재생성이 돌려주는 숫자가 달 조회의 근무일 행 수와 달라지면, 화면이 말하는 숫자와
    // 실제로 깔린 달력이 갈린다.
    expect(workdaysInYear(year)).toBe(byMonth)
  })

  it('한 해는 주말만 빼도 260일 언저리다', () => {
    // 휴일을 아무리 넣어도 이 범위를 벗어나면 계산이 깨진 것이다.
    const count = workdaysInYear(Number(month.slice(0, 4)))
    expect(count).toBeGreaterThan(220)
    expect(count).toBeLessThanOrEqual(262)
  })
})
