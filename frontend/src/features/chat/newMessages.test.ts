import { expect, test } from 'vitest'
import { countAfter } from './newMessages'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('올라간 뒤에 온 메시지만 센다', () => {
  expect(countAfter(items, 'a')).toBe(2)
  expect(countAfter(items, 'c')).toBe(0)
})

test('바닥에 있거나 기준 메시지가 지워졌으면 0', () => {
  expect(countAfter(items, null)).toBe(0)
  expect(countAfter(items, 'gone')).toBe(0)
})
