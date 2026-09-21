import { describe, expect, it } from 'vitest'
import { appendMessage, errorText, withLastMessage, withUnread } from './events'
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

describe('withLastMessage', () => {
  it('그 채널의 마지막 메시지를 바꾼다', () => {
    const list = { items: [channel('c1', 0), channel('c2', 0)] }
    const next = withLastMessage(list, message('m2'))
    expect(next?.items[0].last_message?.id).toBe('m2')
    expect(next?.items[1].last_message).toBeNull()
  })

  it('이미 더 최신이면 과거로 되돌리지 않는다', () => {
    // 두 탭이 붙었다 끊기는 사이에 늦게 도착한 옛 메시지가 목록의 마지막 줄을 과거로
    // 바꾸면 목록이 거짓이 된다.
    const newer = { ...message('m9'), created_at: '2026-09-21T03:00:00Z' }
    const list = { items: [{ ...channel('c1', 0), last_message: newer }] }
    expect(withLastMessage(list, message('m2'))?.items[0].last_message?.id).toBe('m9')
  })

  it('메시지가 온 채널이 맨 위로 온다', () => {
    // 순서는 서버가 정하는 값이다(최근 대화가 위로). 재조회를 뺐으니 여기서 맞춰야 하고,
    // 안 맞추면 조용한 채널의 행이 제자리에 머물다 다음 재조회에서 갑자기 뛴다.
    const busy = { ...channel('c1', 0), last_message: { ...message('m1'), channel_id: 'c1' } }
    const quiet = { ...channel('c2', 0), name: 'c2' }
    const list = { items: [busy, quiet] }
    const arrived = { ...message('m5'), channel_id: 'c2', created_at: '2026-09-21T04:00:00Z' }
    expect(withLastMessage(list, arrived)?.items.map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('대화가 없는 채널은 아래에 이름순으로 남는다', () => {
    const list = { items: [channel('c-b', 0), channel('c-a', 0)] }
    const arrived = { ...message('m5'), channel_id: 'nope' }
    expect(withLastMessage(list, arrived)?.items.map((c) => c.id)).toEqual(['c-a', 'c-b'])
  })

  it('모르는 채널이면 그대로 둔다', () => {
    const list = { items: [channel('c9', 0)] }
    expect(withLastMessage(list, message('m2'))?.items[0].last_message).toBeNull()
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
    expect(errorText({ code: 'VALIDATION', detail })).toBe('채팅 서버가 요청을 거절했습니다.')
  })

  it('문구를 못 뽑을 때도 보내기를 단정하지 않는다', () => {
    // 읽음·타이핑도 같은 error 로 거절된다. 아무것도 안 썼는데 발송 실패라고 뜨면 안 된다.
    for (const code of ['FORBIDDEN', 'VALIDATION']) {
      expect(errorText({ code, detail: null })).not.toMatch(/보내|발송/)
    }
  })

  it('빈 문구는 서버가 준 것으로 보지 않는다', () => {
    expect(errorText({ code: 'VALIDATION', detail: '   ' })).toBe(
      '채팅 서버가 요청을 거절했습니다.',
    )
  })
})
