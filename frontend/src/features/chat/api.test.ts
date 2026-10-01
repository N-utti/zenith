import { expect, test } from 'vitest'
import { supportsPrivate } from './api'
import type { ChatChannel } from './types'

const channel = (extra: Partial<ChatChannel>): ChatChannel => ({
  id: 'c-1',
  name: '개발',
  is_dm: false,
  members: [],
  unread: 0,
  last_message: null,
  ...extra,
})

// 이 판정이 틀리면 비공개를 모르는 서버에 비공개를 요청하고, 서버는 공개 채널을 만든다.
test('서버가 is_private 를 줄 때만 비공개 채널을 만들 수 있다', () => {
  expect(supportsPrivate([])).toBe(false)
  expect(supportsPrivate([channel({})])).toBe(false)
  // 공개 채널뿐이어도 칸이 실려 오면 아는 서버다.
  expect(supportsPrivate([channel({ is_private: false })])).toBe(true)
})
