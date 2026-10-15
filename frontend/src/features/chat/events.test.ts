import { describe, expect, it } from 'vitest'
import {
  appendMessage,
  errorText,
  prependOlder,
  removeMessage,
  replaceMessage,
  withEditedLast,
  withLastMessage,
  withUnread,
} from './events'
import type { ChatChannel, ChatMessage } from './types'

function message(id: string): ChatMessage {
  return {
    id,
    channel_id: 'c1',
    author: { id: 'u1', name: '정성운', is_bot: false },
    body: '안녕하세요',
    doc_ref: null,
    attachments: null,
    created_at: '2026-09-21T02:00:00Z',
    edited_at: null,
  }
}

function channel(id: string, unread: number): ChatChannel {
  return {
    id,
    name: id,
    is_dm: false,
    is_private: false,
    members: [],
    unread,
    last_message: null,
    can_delete: false,
    created_by: null,
  }
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

  it('더 과거를 부르는 커서를 버리지 않는다', () => {
    // 버리면 새 메시지가 하나 온 순간부터 「이전 메시지 더 보기」가 사라진다.
    const page = { items: [message('m1')], next_cursor: 'c-1' }
    expect(appendMessage(page, message('m2'))?.next_cursor).toBe('c-1')
  })
})

describe('prependOlder', () => {
  it('더 과거 한 쪽을 앞에 붙이고 커서를 그 쪽의 것으로 바꾼다', () => {
    const page = { items: [message('m3'), message('m4')], next_cursor: 'c-3' }
    const older = { items: [message('m1'), message('m2')], next_cursor: 'c-1' }
    const next = prependOlder(page, older, 'c-3')
    expect(next?.items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(next?.next_cursor).toBe('c-1')
  })

  it('맨 처음까지 받으면 커서가 비어 버튼이 사라진다', () => {
    const page = { items: [message('m2')], next_cursor: 'c-2' }
    const next = prependOlder(page, { items: [message('m1')], next_cursor: null }, 'c-2')
    expect(next?.next_cursor).toBeNull()
  })

  it('이미 있는 메시지는 두 번 넣지 않는다', () => {
    // 과거를 받는 사이 목록을 다시 받으면 두 쪽이 겹친다.
    const page = { items: [message('m2'), message('m3')], next_cursor: 'c-2' }
    const older = { items: [message('m1'), message('m2')], next_cursor: null }
    expect(prependOlder(page, older, 'c-2')?.items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('받는 사이 목록이 다시 받아졌으면 붙이지 않는다', () => {
    // 100개까지 붙여 둔 상태에서 더 과거(c-100 앞)를 청했는데, 응답 전에 목록이 최근 50개로
    // 돌아갔다(커서 c-50). 붙이면 51~100번째가 빈 채로 커서만 넘어간다.
    const page = { items: [message('m151')], next_cursor: 'c-50' }
    const older = { items: [message('m1')], next_cursor: 'c-150' }
    expect(prependOlder(page, older, 'c-100')).toBe(page)
  })

  it('목록이 사라졌으면 아무것도 하지 않는다', () => {
    const older = { items: [message('m1')], next_cursor: null }
    expect(prependOlder(undefined, older, 'c-1')).toBeUndefined()
  })
})

describe('replaceMessage', () => {
  it('같은 id 의 메시지를 제자리에 갈아 끼우고 나머지 칸은 그대로 둔다', () => {
    const page = { items: [message('m1'), message('m2')], next_cursor: 'c-1' }
    const edited = { ...message('m1'), body: '고친 글', edited_at: '2026-09-21T02:05:00Z' }
    const next = replaceMessage(page, edited)
    expect(next?.items.map((m) => m.body)).toEqual(['고친 글', '안녕하세요'])
    expect(next?.next_cursor).toBe('c-1')
  })

  it('목록에 없는 메시지면 같은 객체를 돌려준다', () => {
    // 아직 안 받은 과거의 메시지다. 그 쪽을 받을 때 서버가 고친 뒤의 것을 준다.
    const page = { items: [message('m2')] }
    expect(replaceMessage(page, message('m1'))).toBe(page)
  })
})

describe('removeMessage', () => {
  it('그 id 만 뺀다', () => {
    const page = { items: [message('m1'), message('m2')], next_cursor: null }
    expect(removeMessage(page, 'm1')?.items.map((m) => m.id)).toEqual(['m2'])
  })

  it('없는 id 면 같은 객체를 돌려준다', () => {
    // 탭이 여러 개면 같은 이벤트가 중복으로 온다. 두 번째는 아무 일도 없어야 한다.
    const page = { items: [message('m1')] }
    expect(removeMessage(page, 'm9')).toBe(page)
    expect(removeMessage(undefined, 'm1')).toBeUndefined()
  })
})

describe('withEditedLast', () => {
  it('고쳐진 메시지가 마지막 메시지였던 채널의 미리보기만 바꾼다', () => {
    const list = {
      items: [
        { ...channel('c1', 0), last_message: message('m1') },
        { ...channel('c2', 0), last_message: message('m2') },
      ],
    }
    const next = withEditedLast(list, { ...message('m1'), body: '고친 글' })
    expect(next?.items.map((c) => c.last_message?.body)).toEqual(['고친 글', '안녕하세요'])
  })

  it('마지막 메시지가 아니면 같은 객체를 돌려준다', () => {
    const list = { items: [{ ...channel('c1', 0), last_message: message('m2') }] }
    expect(withEditedLast(list, message('m1'))).toBe(list)
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
