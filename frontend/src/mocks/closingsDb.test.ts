import { expect, it } from 'vitest'
import { currentMonth, shiftMonth } from '@/lib/datetime'
import { MOCK_USERS } from './db'
import { closeMonth, getClosing, isClosedRange, reopenMonth } from './closingsDb'

const exec = MOCK_USERS.find((u) => u.role === 'exec')!
const twoAgo = shiftMonth(currentMonth(), -2)
// 모듈 전역 Map 을 공유하고 리셋이 없다. 케이스를 더할 때 다른 테스트가 쓰는 달을 잡지 말 것.

it('마감하면 그 달 날짜가 잠기고, 사유를 적어 해제하면 이력이 최신순으로 쌓인다', () => {
  expect(isClosedRange(`${twoAgo}-10`)).toBe(false)
  expect('item' in closeMonth(exec, twoAgo)).toBe(true)
  expect(isClosedRange(`${twoAgo}-10`)).toBe(true)
  // 가운데 달만 마감돼도 걸린다.
  expect(isClosedRange(`${shiftMonth(twoAgo, -1)}-28`, `${shiftMonth(twoAgo, 1)}-02`)).toBe(true)
  expect(closeMonth(exec, twoAgo)).toMatchObject({ status: 409 })
  expect(reopenMonth(exec, twoAgo, ' ')).toMatchObject({ status: 422 })
  expect('item' in reopenMonth(exec, twoAgo, '누락 정정')).toBe(true)
  expect(isClosedRange(`${twoAgo}-10`)).toBe(false)
  expect(getClosing(twoAgo).history.map((h) => h.action)).toEqual(['reopen', 'close'])
})

it('오지 않은 달은 마감할 수 없고, 지난달은 마감된 채로 시작한다', () => {
  expect(closeMonth(exec, shiftMonth(currentMonth(), 1))).toMatchObject({ status: 422 })
  expect(getClosing(shiftMonth(currentMonth(), -1)).status).toBe('closed')
})
