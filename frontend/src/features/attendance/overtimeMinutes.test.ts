import { describe, expect, it } from 'vitest'
import { overtimeMinutes, overtimeSpan } from './overtimeMinutes'

/** 10 §11 TC-ATT-05 · 06 · 07 을 그대로 옮겼다. */
describe('연장근로 분 산출', () => {
  it('18:00~21:00 은 180분, 야간 0', () => {
    expect(overtimeMinutes('18:00', '21:00')).toEqual({
      minutes: 180,
      night_minutes: 0,
    })
  })

  it('20:00~익일 01:00 은 300분, 야간 180분(22~01)', () => {
    expect(overtimeMinutes('20:00', '01:00')).toEqual({
      minutes: 300,
      night_minutes: 180,
    })
  })

  it('17:00~20:00 은 18:00 부터 세어 120분', () => {
    expect(overtimeMinutes('17:00', '20:00')).toEqual({
      minutes: 120,
      night_minutes: 0,
    })
  })

  it('종업 전에 끝나면 0', () => {
    expect(overtimeMinutes('16:00', '17:30')).toEqual({
      minutes: 0,
      night_minutes: 0,
    })
  })

  it('야간은 22시~06시에서 잘린다', () => {
    expect(overtimeMinutes('18:00', '06:00')).toEqual({ minutes: 720, night_minutes: 480 })
    expect(overtimeMinutes('22:00', '07:00')).toEqual({ minutes: 540, night_minutes: 480 })
  })

  it('쉬는 날은 18:00 전 구간도 전부 센다', () => {
    expect(overtimeMinutes('10:00', '15:00', true)).toEqual({ minutes: 300, night_minutes: 0 })
    // 새벽 구간도 야간이다. 근무일에는 18:00 뒤로 밀려 닿을 일이 없던 구간.
    expect(overtimeMinutes('04:00', '08:00', true)).toEqual({ minutes: 240, night_minutes: 120 })
    expect(overtimeMinutes('20:00', '01:00', true)).toEqual({ minutes: 300, night_minutes: 180 })
  })

  it('구간 길이는 18:00 으로 당기기 전 값이고 자정을 넘긴다', () => {
    expect(overtimeSpan('08:00', '21:00')).toBe(780)
    expect(overtimeSpan('20:00', '01:00')).toBe(300)
    expect(overtimeSpan('', '20:00')).toBe(0)
  })

  it('같은 시각과 빈 입력은 0. 24시간이나 NaN 이 되지 않는다', () => {
    expect(overtimeMinutes('18:00', '18:00')).toEqual({ minutes: 0, night_minutes: 0 })
    expect(overtimeMinutes('', '20:00')).toEqual({ minutes: 0, night_minutes: 0 })
  })
})
