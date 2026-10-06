import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ToastContext, type ToastApi } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { chatKeys } from './api'
import { NewChatModal } from './NewChatModal'
import type { ChatChannel } from './types'

// 서버 자리. 무엇을 보냈는지와, 서버가 돌려준 채널을 화면이 어떻게 읽는지를 본다.
const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const people = [
  { id: 'me', name: '나', active: true },
  { id: 'u1', name: '정성운', active: true },
]
const auth = { user: people[0], status: 'authenticated' } as unknown as AuthValue
const toast: ToastApi = { success: vi.fn(), error: vi.fn(), info: vi.fn() }

// `is_private` 를 일부러 뺀다. 칸을 안 주는 #236 이전 서버의 응답이다. 타입은 필수라 단언한다.
const old: Omit<ChatChannel, 'is_private'> = {
  id: 'c-1',
  name: '개발',
  is_dm: false,
  members: [],
  unread: 0,
  last_message: null,
  can_delete: false,
  created_by: null,
}
const channel = (extra: Partial<ChatChannel>) => ({ ...old, ...extra }) as ChatChannel

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  vi.clearAllMocks()
})

/** 「새 채널」 모달을 연다. `channels` 가 서버가 준 채널 목록, `roster` 가 사람 목록이다. */
function open(channels: ChatChannel[], roster: object[] = people) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  qc.setQueryData(chatKeys.channels, { items: channels })
  qc.setQueryData(['people'], { items: roster })
  root = createRoot(document.createElement('div'))
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          AuthContext,
          { value: auth },
          createElement(
            ToastContext,
            { value: toast },
            createElement(
              MemoryRouter,
              null,
              createElement(NewChatModal, { mode: 'channel', onClose() {}, onCreated() {} }),
            ),
          ),
        ),
      ),
    ),
  )
}

// 모달은 body 로 포털된다.
const dialog = () => document.querySelector('[role=dialog]')!
const button = (label: string) =>
  // 사람 칩은 아바타 글자가 이름 앞에 붙는다. 끝으로 견준다.
  [...dialog().querySelectorAll('button')].find((b) => b.textContent.endsWith(label))!

async function create(name: string) {
  const input = dialog().querySelector<HTMLInputElement>('input:not([type=checkbox])')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    button('만들기').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const sent = () => JSON.parse((api.mock.calls[0][1] as { body: string }).body) as unknown

test('서버가 비공개를 모르면 체크가 없고, 공개 채널 요청만 나간다', async () => {
  api.mockResolvedValue(channel({ id: 'c-2', name: '디자인' }))
  open([channel({})])

  expect(dialog().querySelector('input[type=checkbox]')).toBeNull()
  await create('디자인')
  expect(sent()).toEqual({ name: '디자인' })
})

test('비공개로 만들면 두 칸이 같이 나가고, 서버가 공개로 돌려주면 성공이라고 하지 않는다', async () => {
  // 목록에는 칸을 주면서 생성 요청의 칸은 버리는 서버. 돌아온 채널이 비공개가 아니다.
  api.mockResolvedValue(channel({ id: 'c-2', name: '인사', is_private: false }))
  open([channel({ is_private: false })])

  act(() => dialog().querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  act(() => button('정성운').click())
  await create('인사')

  expect(sent()).toEqual({ name: '인사', is_private: true, member_ids: ['u1'] })
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('고른 대로 만들어지지 않았습니다'),
    expect.anything(),
  )
})

test('비공개 표시는 달려 왔어도 고르지 않은 사람이 들어 있으면 성공이라고 하지 않는다', async () => {
  // 표시만 저장하고 멤버는 예전대로 전원을 넣는 서버.
  const everyone = [...people, { id: 'u2', name: '홍성완' }]
  api.mockResolvedValue(channel({ id: 'c-2', name: '인사', is_private: true, members: everyone }))
  open([channel({ is_private: false })])

  act(() => dialog().querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  act(() => button('정성운').click())
  await create('인사')

  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalled()
})

test('서버가 등급을 주면 함께할 사람을 임원과 사원으로 가른다', () => {
  open(
    [channel({ is_private: false })],
    [
      people[0],
      { ...people[1], role: 'member' },
      { id: 'u2', name: '홍성완', active: true, role: 'exec' },
    ],
  )
  act(() => dialog().querySelector<HTMLInputElement>('input[type=checkbox]')!.click())

  const groups = [...dialog().querySelectorAll('[role=group]')].map(
    (group) => `${group.getAttribute('aria-label')}: ${group.querySelectorAll('button').length}`,
  )
  expect(groups).toEqual(['함께할 사람: 2', '임원: 1', '사원: 1'])
})
