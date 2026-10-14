import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { useAsk } from './api'
import { getThread, resetThread } from './store'

/**
 * 세 군데서 멈춘다. 첫 토큰 전, 답변을 쓰다가 다시 문서를 찾는 동안, 닫히기 직전. `release()` 마다 한 구간씩 흘린다.
 * 답변 말풍선은 답변의 첫 이벤트에서 생긴다.
 */
let release: () => void = () => {}
const gate = () => new Promise<void>((resolve) => (release = resolve))
/** 끝까지 읽든 도중에 빠져나가든 스트림이 닫히면 켜진다. */
const stream = vi.hoisted(() => ({ closed: false, body: '' }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: vi.fn(),
  async *apiEvents(_path: string, init: { body: string }) {
    stream.closed = false
    stream.body = init.body
    try {
      // 서버는 문서를 찾는 동안 답변보다 먼저 진행 상황을 보낸다. 이것은 말풍선을 만들지 않는다.
      yield { event: 'status', data: { text: '문서를 찾는 중' } }
      await gate()
      yield { event: 'token', data: { text: '앞사람 답변' } }
      // 모델이 글을 쓰다가 다시 찾으러 갔다. 말풍선은 이미 있다.
      yield { event: 'status', data: { text: '다시 찾는 중' } }
      await gate()
      yield { event: 'token', data: { text: ' 이어서' } }
      await gate()
      yield { event: 'done', data: { message_id: 'srv-1', session_id: 's-1' } }
    } finally {
      stream.closed = true
    }
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('답변이 오기 전에 대화가 비워지면 그 답변을 새 대화에 붙이지 않는다', async () => {
  let ask: ReturnType<typeof useAsk> | undefined
  function Grab() {
    ask = useAsk()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Grab)),
    ),
  )

  let done: Promise<unknown> = Promise.resolve()
  await act(async () => {
    done = ask!.mutateAsync({ prompt: '질문', scope: null })
  })
  // 질문만 붙고 답변은 아직 첫 토큰을 기다리는 상태.
  expect(getThread().messages.map((m) => m.body)).toEqual(['질문'])
  expect(getThread().status).toBe('문서를 찾는 중')

  resetThread()
  await act(async () => {
    release()
    await done
  })
  expect(getThread().messages).toEqual([])
  expect(stream.closed).toBe(true)
  act(() => root.unmount())
})

test('done 이 알려 준 서버 답변 id 를 답변에 붙인다', async () => {
  let ask: ReturnType<typeof useAsk> | undefined
  function Grab() {
    ask = useAsk()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Grab)),
    ),
  )

  let done: Promise<unknown> = Promise.resolve()
  await act(async () => {
    done = ask!.mutateAsync({ prompt: '질문', scope: null })
  })
  await act(async () => {
    release()
    await new Promise((resolve) => setTimeout(resolve))
  })
  // 답변을 쓰다가 다시 찾는 중. 받은 데까지의 말풍선은 그대로 있고 진행 문구가 다시 켜진다.
  expect(getThread().messages.at(-1)).toMatchObject({ role: 'assistant', body: '앞사람 답변' })
  expect(getThread().status).toBe('다시 찾는 중')

  await act(async () => {
    release()
    await new Promise((resolve) => setTimeout(resolve))
  })
  // 답변이 다시 흐르면 문구가 꺼진다. 스트림이 닫혀서가 아니다(아직 열려 있다).
  expect(getThread().messages.at(-1)).toMatchObject({ body: '앞사람 답변 이어서' })
  expect(getThread().status).toBeNull()
  expect(stream.closed).toBe(false)

  await act(async () => {
    release()
    await done
  })
  // 여기서는 붙는 것까지만 본다. 평가가 이 id 로 나가는 연결은 `Conversation` 에 있다.
  expect(getThread().messages.at(-1)).toMatchObject({
    role: 'assistant',
    body: '앞사람 답변 이어서',
    serverId: 'srv-1',
  })
  expect(getThread().status).toBeNull()
  resetThread()
  act(() => root.unmount())
})

test('참고 문서와 첨부를 요청에 싣고 질문 말풍선에 남긴다(다시 받을 때 같은 것으로)', async () => {
  let ask: ReturnType<typeof useAsk> | undefined
  function Grab() {
    ask = useAsk()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() =>
    root.render(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Grab)),
    ),
  )

  let done: Promise<unknown> = Promise.resolve()
  await act(async () => {
    done = ask!.mutateAsync({
      prompt: '질문',
      scope: 'f-1',
      docs: ['d-1', 'd-2'],
      attachments: ['a-1'],
    })
  })
  expect(JSON.parse(stream.body)).toMatchObject({
    scope: 'f-1',
    docs: ['d-1', 'd-2'],
    attachments: ['a-1'],
  })
  expect(getThread().messages[0]).toMatchObject({
    role: 'user',
    docs: ['d-1', 'd-2'],
    attachments: ['a-1'],
  })

  for (let i = 0; i < 3; i++) {
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve))
    })
  }
  await act(async () => {
    await done
  })
  resetThread()
  act(() => root.unmount())
})
