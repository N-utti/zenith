import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { restoreThread, useAsk } from './api'
import { getSessionId, getThread, resetThread, switchTo } from './store'

/**
 * 서버(백엔드 #430)는 연결이 끊겨도 답을 끝까지 만든다. 경로마다 무엇을 돌려줄지 테스트가 정한다.
 * `chat`·`stream` 은 이벤트 목록이고, 끝에 `done`·`error` 가 없으면 종료 이벤트 없이 닫힌 것이다.
 */
type Step = { event: string; data: unknown } | 'wait' | 'drop'
const server = vi.hoisted(() => ({
  /** `'wait'` 은 `release()` 까지 멈추고, `'drop'` 은 연결이 끊긴 것처럼 던진다(fetch 의 TypeError). */
  chat: [] as Step[],
  stream: null as Step[] | null,
  detail: null as unknown,
  calls: [] as string[],
}))
const gate = vi.hoisted(() => ({ release: () => {} }))
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    readonly status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    async api(path: string) {
      server.calls.push(`GET ${path}`)
      if (!server.detail) throw new ApiError(404, '없는 대화입니다.')
      return server.detail
    },
    async *apiEvents(path: string) {
      server.calls.push(path.endsWith('/stream') ? `GET ${path}` : `POST ${path}`)
      const steps = path.endsWith('/stream') ? server.stream : server.chat
      if (!steps) throw new ApiError(404, '만드는 중인 답변이 없습니다.')
      for (const step of steps) {
        if (step === 'wait') await new Promise<void>((resolve) => (gate.release = resolve))
        else if (step === 'drop') throw new TypeError('Failed to fetch')
        else yield step
      }
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetThread()
  Object.assign(server, { chat: [], stream: null, detail: null, calls: [] })
})

function mount() {
  let hook: ReturnType<typeof useAsk> | undefined
  function Grab() {
    hook = useAsk()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Grab)),
    ),
  )
  return {
    send: (prompt: string) =>
      hook!.mutateAsync({ prompt, scope: null }).catch((error: Error) => error) as Promise<unknown>,
    unmount: () => act(() => root.unmount()),
  }
}

async function ask(prompt: string) {
  const page = mount()
  let result: unknown
  await act(async () => {
    result = await page.send(prompt)
  })
  page.unmount()
  return result
}

const saved = (question: string, answer: string) => ({
  id: getSessionId(),
  model: 'm',
  created_at: '',
  messages: [
    { id: 'u-1', role: 'user', body: question, created_at: '' },
    { id: 'a-1', role: 'assistant', body: answer, citations: null, created_at: '' },
  ],
  pending: null,
})

test('종료 이벤트 없이 닫히면 이어 받고, 그사이 끝났으면 서버가 저장한 답을 붙인다', async () => {
  server.chat = [{ event: 'token', data: { text: '받다 만' } }]
  server.detail = saved('질문', '끝까지 만든 답')

  expect(await ask('질문')).toBeUndefined()
  const sid = getSessionId()
  expect(server.calls).toEqual([
    'POST /ai/chat',
    `GET /ai/sessions/${sid}/stream`,
    `GET /ai/sessions/${sid}`,
  ])
  // 받다 만 말풍선은 지우고 저장된 답 하나만 남는다. 평가가 저장된 답에 붙도록 서버 id 도.
  expect(getThread().messages.map((m) => [m.role, m.body, m.serverId])).toEqual([
    ['user', '질문', undefined],
    ['assistant', '끝까지 만든 답', 'a-1'],
  ])
  expect(getThread().busy).toBe(false)
})

test('이어 받으면 처음부터 다시 오는 답으로 말풍선을 새로 채운다', async () => {
  server.chat = [{ event: 'token', data: { text: '받다 만' } }]
  server.stream = [
    { event: 'token', data: { text: '처음부터 ' } },
    { event: 'token', data: { text: '다시' } },
    { event: 'done', data: { message_id: 'a-9' } },
  ]

  expect(await ask('질문')).toBeUndefined()
  expect(getThread().messages.at(-1)).toMatchObject({ body: '처음부터 다시', serverId: 'a-9' })
  expect(getThread().messages).toHaveLength(2)
})

test('서버에 이 질문이 없으면(재시작으로 사라짐) 성공으로 치지 않고 다시 시도하게 한다', async () => {
  server.chat = [{ event: 'token', data: { text: '받다 만' } }]
  // 앞 질문의 답만 저장돼 있다.
  server.detail = saved('앞 질문', '앞 답')

  const error = await ask('질문')
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('답변이 저장되지 않았습니다. 다시 시도해 주세요.')
  // 받은 데까지는 남고 그 자리에 사유가 붙는다.
  expect(getThread().messages.map((m) => [m.body, m.error])).toEqual([
    ['질문', undefined],
    ['받다 만', '답변이 저장되지 않았습니다. 다시 시도해 주세요.'],
  ])
})

test('서버가 보낸 error 는 이어 받지 않는다', async () => {
  server.chat = [{ event: 'error', data: { detail: '요청이 몰려 있습니다.' } }]

  const error = await ask('질문')
  expect((error as Error).message).toBe('요청이 몰려 있습니다.')
  expect(server.calls).toEqual(['POST /ai/chat'])
})

test('되읽을 때 만드는 중인 답이 있으면 그 질문을 그리고 이어 받는다', async () => {
  server.detail = {
    ...saved('앞 질문', '앞 답'),
    pending: { message: '지금 질문', started_at: '' },
  }
  server.stream = [
    { event: 'token', data: { text: '이어 받은 답' } },
    { event: 'done', data: { message_id: 'a-2' } },
  ]

  await restoreThread()
  expect(getThread().messages.map((m) => [m.role, m.body])).toEqual([
    ['user', '앞 질문'],
    ['assistant', '앞 답'],
    ['user', '지금 질문'],
    ['assistant', '이어 받은 답'],
  ])
  expect(getThread().busy).toBe(false)
})

test('아직 묻지 않은 새 대화는 서버에 없어 빈 채로 둔다', async () => {
  await restoreThread()
  expect(getThread().messages).toEqual([])
  expect(getThread().busy).toBe(false)
})

test('이어 받기마저 끊기면 받은 데까지 남기고 그 자리에 사유를 단다', async () => {
  server.chat = [{ event: 'token', data: { text: '받다 만' } }, 'drop']
  server.stream = ['drop']

  const error = await ask('질문')
  expect((error as Error).message).toBe('연결이 끊겨 답변이 중단됐습니다.')
  expect(getThread().messages.at(-1)).toMatchObject({
    role: 'assistant',
    body: '받다 만',
    error: '연결이 끊겨 답변이 중단됐습니다.',
  })
})

test('다른 대화에 갔다가 같은 대화로 돌아와도 옛 루프는 그 대화에 쓰지 않는다', async () => {
  server.chat = [
    { event: 'status', data: { text: '문서를 찾는 중' } },
    'wait',
    { event: 'token', data: { text: '옛 루프' } },
    { event: 'done', data: { message_id: 'a-1' } },
  ]
  const page = mount()
  let done: Promise<unknown> = Promise.resolve()
  await act(async () => {
    done = page.send('질문')
  })
  const sid = getSessionId()
  // 되읽기가 이 대화를 서버에서 다시 그리고 이어 받는다. 옛 루프까지 쓰면 말풍선이 둘이 된다.
  switchTo('other')
  switchTo(sid)
  await act(async () => {
    gate.release()
    expect(await done).toBeUndefined()
  })
  expect(getThread().messages).toEqual([])
  // 옛 루프가 끝나며 새로 들어온 쪽의 받는 중 표시를 풀지 않는다.
  expect(getThread().status).toBeNull()
  page.unmount()
})

test('되읽는 순간 답이 끝나 진행 중 표시와 저장된 답이 함께 오면, 다시 읽은 대로 그려 둘이 되지 않는다', async () => {
  // 서버는 진행 중인 작업을 먼저 보고 메시지를 나중에 읽는다. 그 사이 답이 저장됐다.
  server.detail = { ...saved('질문', '답'), pending: { message: '질문', started_at: '' } }

  await restoreThread()
  expect(getThread().messages.map((m) => [m.role, m.body])).toEqual([
    ['user', '질문'],
    ['assistant', '답'],
  ])
})
