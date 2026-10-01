import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { chatKeys } from '@/features/chat/api'
import { ChatSocketContext } from '@/features/chat/ChatSocketContext'
import { appendMessage, withLastMessage, withUnread } from '@/features/chat/events'
import type { ChatChannel, ChatMessage } from '@/features/chat/types'
import type { ChatSocket } from '@/features/chat/useChatSocket'
import { ChatPage } from './ChatPage'

// 줄마다 본문을 한 번 그린다. 이 호출 수가 곧 다시 그려진 줄 수다.
const drawn = vi.hoisted(() => vi.fn())
vi.mock('@/features/people/MentionText', () => ({
  MentionText: ({ body }: { body: string }) => {
    drawn(body)
    return body
  },
}))
// 여기서 보는 것은 메시지 목록뿐이다. 나머지는 저마다 쿼리를 불러 비워 둔다.
vi.mock('@/features/chat/Composer', () => ({ Composer: () => null }))
vi.mock('@/features/notifications/api', () => ({
  useNotifications: () => ({ data: undefined }),
  useMarkNotificationsRead: () => ({ mutate: () => {} }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 에는 없다. 목록은 그릴 때마다 맨 아래로 내린다.
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  vi.useRealTimers()
  drawn.mockClear()
})

const people = [
  { id: 'me', name: '나', active: true },
  { id: 'u1', name: '정성운', active: true },
]
const auth = { user: people[0], status: 'authenticated' } as unknown as AuthValue
const socket = {
  connected: true,
  typingByChannel: {},
  notifyTyping: () => {},
  sendRead: () => {},
} as unknown as ChatSocket

function message(channelId: string, n: number): ChatMessage {
  return {
    id: `${channelId}-${n}`,
    channel_id: channelId,
    author: { id: 'u1', name: '정성운' },
    body: `${channelId}-${n}`,
    doc_ref: null,
    attachments: null,
    created_at: `2026-10-01T03:0${n}:00Z`,
  }
}

function channel(id: string, last: ChatMessage | null): ChatChannel {
  // 멤버 배열은 채널마다 따로다(서버 응답이 그렇다). 같은 객체를 나눠 쓰면 순서가 바뀌어도
  // react-query 가 참조를 유지해, 아래 테스트가 보려는 상황이 안 만들어진다.
  return { id, name: id, is_dm: false, members: [...people], unread: 0, last_message: last }
}

/** 방 `c` 를 보고 있다. 줄은 셋, 채널 목록에는 조용한 방 `d` 가 아래에 있다. */
function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  const first = [message('c', 1), message('c', 2), message('c', 3)]
  qc.setQueryData(chatKeys.channels, { items: [channel('c', first[2]), channel('d', null)] })
  qc.setQueryData(chatKeys.messages('c'), { items: first, next_cursor: null })
  qc.setQueryData(['people'], { items: people })

  const container = document.createElement('div')
  act(() =>
    createRoot(container).render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            ChatSocketContext,
            { value: socket },
            createElement(
              MemoryRouter,
              { initialEntries: ['/chat/c'] },
              createElement(
                Routes,
                null,
                createElement(Route, {
                  path: '/chat/:channelId',
                  element: createElement(ChatPage),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  return { qc, container }
}

/** 소켓이 `msg` 와 뒤따르는 `unread` 로 캐시에 하는 일 그대로(`useChatSocket`). */
async function receive(qc: QueryClient, incoming: ChatMessage, unread: number) {
  await act(async () => {
    qc.setQueryData<{ items: ChatMessage[] }>(chatKeys.messages(incoming.channel_id), (old) =>
      appendMessage(old, incoming),
    )
    qc.setQueryData<{ items: ChatChannel[] }>(chatKeys.channels, (old) =>
      withLastMessage(old, incoming),
    )
    qc.setQueryData<{ items: ChatChannel[] }>(chatKeys.channels, (old) =>
      withUnread(old, incoming.channel_id, unread),
    )
    // react-query 는 구독자에게 다음 틱에 알린다. 그 알림이 돈 뒤에 센다.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

test('다른 방에 글이 와도 줄을 다시 그리지 않고, 이 방에 오면 그 한 줄만 그린다', async () => {
  const { qc } = open()
  expect(drawn).toHaveBeenCalledTimes(3)

  // 조용하던 방이 보는 방을 추월해 목록 순서가 바뀐다. 채널 객체도 멤버 배열도 새 참조가 된다.
  drawn.mockClear()
  await receive(qc, message('d', 4), 1)
  const order = qc.getQueryData<{ items: ChatChannel[] }>(chatKeys.channels)?.items.map((c) => c.id)
  expect(order).toEqual(['d', 'c'])
  expect(drawn).not.toHaveBeenCalled()

  await receive(qc, message('c', 5), 0)
  expect(drawn.mock.calls).toEqual([['c-5']])
})

test('자정을 넘기면 건너뛴 줄의 날짜 줄도 「어제」 로 바뀐다', async () => {
  // 시계만 가짜로 둔다. 타이머까지 멈추면 react-query 의 알림이 안 돈다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T06:00:00Z'))
  const { qc, container } = open()
  expect(container.textContent).toContain('오늘')

  vi.setSystemTime(new Date('2026-10-02T06:00:00Z'))
  await receive(qc, message('d', 4), 1)
  expect(container.textContent).toContain('어제')
  expect(container.textContent).not.toContain('오늘')
})
