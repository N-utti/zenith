import { expect, it } from 'vitest'
import { currentMonth, shiftMonth } from '@/lib/datetime'
import { MOCK_USERS } from './db'
import { attendanceMonth } from './attendanceDb'
import { addHoliday, isHoliday, listHolidays, removeHoliday } from './holidaysDb'

// closingsDb 의 데모 시드가 모듈 로드 때 지난달을 마감해 둔다. 그 달의 날짜로 차단을 본다.
const closed = `${shiftMonth(currentMonth(), -1)}-15`

it('추가하면 휴일이 되고, 중복은 409, 지우면 풀린다', () => {
  expect(addHoliday({ date: '2031-07-17', name: '제헌절', kind: 'public' })).toHaveProperty('item')
  expect(isHoliday('2031-07-17')).toBe(true)
  expect(addHoliday({ date: '2031-07-17', name: '또', kind: 'company' })).toMatchObject({
    status: 409,
  })
  expect(listHolidays(2031).map((h) => h.name)).toEqual(['제헌절'])
  expect(removeHoliday('2031-07-17')).toBe('ok')
  expect(isHoliday('2031-07-17')).toBe(false)
  expect(removeHoliday('2031-07-17')).toBe('not_found')
})

it('입력 검증과 마감된 달 차단', () => {
  expect(addHoliday({ date: '2031-13-01', name: 'x', kind: 'public' })).toMatchObject({
    status: 422,
  })
  expect(addHoliday({ date: '2031-02-30', name: 'x', kind: 'public' })).toMatchObject({
    status: 422,
  })
  expect(addHoliday({ date: '2031-01-02', name: ' ', kind: 'public' })).toMatchObject({
    status: 422,
  })
  expect(addHoliday({ date: closed, name: '임시', kind: 'company' })).toMatchObject({
    code: 'MONTH_CLOSED',
  })
})

it('휴일을 넣으면 그 날 근무일 행이 사라지고, 빼면 돌아온다', () => {
  const user = MOCK_USERS[0]
  const before = attendanceMonth(user, '2031-07').days.length
  addHoliday({ date: '2031-07-17', name: '제헌절', kind: 'public' })
  expect(attendanceMonth(user, '2031-07').days.length).toBe(before - 1)
  removeHoliday('2031-07-17')
  expect(attendanceMonth(user, '2031-07').days.length).toBe(before)
})
