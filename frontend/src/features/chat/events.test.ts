import { describe, expect, it } from 'vitest'
import { appendMessage, errorText, withUnread } from './events'
import type { ChatChannel, ChatMessage } from './types'

function message(id: string): ChatMessage {
  return {
    id,
    channel_id: 'c1',
    author: { id: 'u1', name: '정성운' },
    body: '안녕하세요',
    doc_ref: null,
    attachments: null,
    created_at: '2026-09-21T02:00:00Z',
  }
}

function channel(id: string, unread: number): ChatChannel {
  return { id, name: id, is_dm: false, members: [], unread, last_message: null }
}

describe('appendMessage', () => {
  it('받은 메시지를 끝에 붙인다', () => {
    const page = { items: [message('m1')] }
    expect(appendMessage(page, message('m2'))?.items.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('같은 id 는 두 번 붙이지 않는다', () => {
    // 탭이 여러 개면 같은 이벤트가 중복으로 온다. 그때 같은 메시지가 두 줄이 되면 안 된다.
    const page = { items: [message('m1')] }
    expect(appendMessage(page, message('m1'))).toBe(page)
  })

  it('아직 안 받은 목록에는 아무것도 하지 않는다', () => {
    expect(appendMessage(undefined, message('m1'))).toBeUndefined()
  })
})

describe('withUnread', () => {
  it('그 채널의 숫자만 바꾼다', () => {
    const list = { items: [channel('c1', 3), channel('c2', 5)] }
    expect(withUnread(list, 'c1', 0)?.items).toEqual([channel('c1', 0), channel('c2', 5)])
  })

  it('모르는 채널이면 그대로 둔다', () => {
    const list = { items: [channel('c1', 3)] }
    expect(withUnread(list, 'c9', 7)?.items).toEqual([channel('c1', 3)])
  })

  it('아직 안 받은 목록에는 아무것도 하지 않는다', () => {
    expect(withUnread(undefined, 'c1', 0)).toBeUndefined()
  })
})

describe('errorText', () => {
  it('서버 문구가 있으면 그대로 보여준다', () => {
    expect(errorText({ code: 'VALIDATION', detail: '이 채널에 올린 첨부가 아닙니다.' })).toBe(
      '이 채널에 올린 첨부가 아닙니다.',
    )
  })

  it('필드별 오류 배열은 일반 문구로 바꾼다', () => {
    // 프레임이 스키마에 안 맞으면 pydantic 오류가 배열로 온다. 사용자에게 뜻이 없다.
    const detail = [{ type: 'missing', loc: ['body'], msg: 'Field required' }]
    expect(errorText({ code: 'VALIDATION', detail })).toBe('메시지를 보내지 못했습니다.')
  })

  it('권한 오류는 권한 문구로 바꾼다', () => {
    expect(errorText({ code: 'FORBIDDEN', detail: null })).toBe('이 대화에 글을 쓸 수 없습니다.')
  })

  it('빈 문구는 서버가 준 것으로 보지 않는다', () => {
    expect(errorText({ code: 'VALIDATION', detail: '   ' })).toBe('메시지를 보내지 못했습니다.')
  })
})
