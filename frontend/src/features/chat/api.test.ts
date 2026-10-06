import { expect, test } from 'vitest'
import { ApiError } from '@/lib/api'
import { channelNameFailure, checkChannelName, supportsPrivate } from './api'
import type { ChatChannel } from './types'

// `is_private` 를 일부러 뺀다. 칸을 안 주는 #236 이전 서버의 응답이다. 타입은 필수라 단언한다.
const old: Omit<ChatChannel, 'is_private'> = {
  id: 'c-1',
  name: '개발',
  is_dm: false,
  members: [],
  unread: 0,
  last_message: null,
}
const channel = (extra: Partial<ChatChannel>) => ({ ...old, ...extra }) as ChatChannel

// 이 판정이 틀리면 비공개를 모르는 서버에 비공개를 요청하고, 서버는 공개 채널을 만든다.
test('서버가 is_private 를 줄 때만 비공개 채널을 만들 수 있다', () => {
  expect(supportsPrivate([])).toBe(false)
  expect(supportsPrivate([channel({})])).toBe(false)
  // 공개 채널뿐이어도 칸이 실려 오면 아는 서버다.
  expect(supportsPrivate([channel({ is_private: false })])).toBe(true)
})

// 서버(`_clean_name`, #308)가 422 로 거절하는 이름을 보내기 전에 거른다. 그 422 는 문구가 배열에
// 들어 있어 화면에 「요청에 실패했습니다 (422)」로만 뜬다.
test('채널 이름을 서버처럼 다듬고, 서버가 거절할 이름은 이유를 준다', () => {
  expect(checkChannelName('  디자인  ')).toEqual({ name: '디자인', error: null })
  // 전각은 반각으로 접힌다. 서버가 저장하는 모양이다.
  expect(checkChannelName('\uff21\uff22').name).toBe('AB')
  expect(checkChannelName('한글 \u{1f44d}').error).toBeNull()
  // 제로폭 공백, 합쳐진 가족 이모지(ZWJ), NUL, 줄 구분자.
  const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}'
  for (const bad of ['공지\u200b', family, 'a\u0000b', 'a\u2028b']) {
    expect(checkChannelName(bad).error).toMatch(/쓸 수 없는 문자/)
  }
  // 정규화가 합자를 풀어 100자를 넘긴다(합자 ffi 한 글자가 세 글자로).
  expect(checkChannelName('\ufb03'.repeat(40)).error).toMatch(/100자/)
  // 이모지는 UTF-16 으로 두 칸이지만 한 글자로 센다.
  expect(checkChannelName('\u{1f44d}'.repeat(100)).error).toBeNull()
  expect(checkChannelName('\u00a0').error).toMatch(/적어/)
})

test('서버의 이름 검증 422(배열 detail)는 알아볼 문구로, 그 밖의 실패는 서버 문구로 낸다', () => {
  const pydantic = new ApiError(422, '요청에 실패했습니다 (422)', {
    detail: [{ msg: 'Value error, 이름에 쓸 수 없는 문자가 있습니다.' }],
    code: 'VALIDATION',
  })
  expect(channelNameFailure(pydantic, '만들지 못했습니다.')).toMatch(/쓸 수 없는 문자/)
  const conflict = new ApiError(409, '같은 이름의 채널이 있습니다.', { code: 'CONFLICT' })
  expect(channelNameFailure(conflict, '만들지 못했습니다.')).toBe('같은 이름의 채널이 있습니다.')
  expect(channelNameFailure(new Error('끊김'), '만들지 못했습니다.')).toBe('만들지 못했습니다.')
})
