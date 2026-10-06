import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ToastContext, type ToastApi } from '@/components/ui/ToastContext'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import { meQueryKey } from '@/features/auth/queries'
import { api, ApiError } from '@/lib/api'
import { useChatSocket } from './useChatSocket'

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}))
const fetchMe = vi.mocked(api)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 열린 소켓을 세고, 서버가 닫은 것처럼 `onclose` 를 부를 수 있게만 한다. */
class FakeSocket {
  static opened: FakeSocket[] = []
  onopen: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  constructor() {
    FakeSocket.opened.push(this)
  }
  close() {}
}

const me = { id: 'me', name: '나' }
const auth = { user: me, status: 'authenticated' } as unknown as AuthValue
const toast: ToastApi = { success: vi.fn(), error: vi.fn(), info: vi.fn() }

/** 소켓을 하나 연다. 돌려준 `close` 는 그 소켓이 `code` 로 닫힌 뒤 재접속 대기 시간이 지난 상태까지 간다. */
async function mount() {
  const qc = new QueryClient()
  qc.setQueryData(meQueryKey, me)

  const Probe = () => {
    useChatSocket()
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          AuthContext,
          { value: auth },
          createElement(ToastContext, { value: toast }, createElement(Probe)),
        ),
      ),
    )
  })
  const close = (code: number) =>
    act(async () => {
      FakeSocket.opened[0].onclose?.({ code })
      await vi.advanceTimersByTimeAsync(5000)
    })
  return { qc, root, close }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.opened = []
  fetchMe.mockReset()
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('이유 없이 끊기면 세션을 묻지 않고 다시 붙는다', async () => {
  const { close } = await mount()
  await close(1006)

  expect(fetchMe).not.toHaveBeenCalled()
  expect(FakeSocket.opened).toHaveLength(2)
})

test('4401 로 닫혔는데 세션이 살아 있으면 다시 붙는다', async () => {
  fetchMe.mockResolvedValue(me)
  const { close } = await mount()
  await close(4401)

  expect(fetchMe).toHaveBeenCalledTimes(1)
  expect(FakeSocket.opened).toHaveLength(2)
})

test('4401 로 닫혔고 세션이 끝났으면 다시 붙지 않고 프로필을 비운다', async () => {
  fetchMe.mockRejectedValue(new ApiError(401, '로그인이 필요합니다.'))
  const { qc, close } = await mount()
  await close(4401)

  expect(FakeSocket.opened).toHaveLength(1)
  expect(qc.getQueryData(meQueryKey)).toBeNull()
})

test('4401 뒤 세션 확인이 서버 오류로 실패하면 프로필을 두고 다시 붙어 본다', async () => {
  fetchMe.mockRejectedValue(new ApiError(502, 'Bad Gateway'))
  const { qc, close } = await mount()
  await close(4401)

  expect(FakeSocket.opened).toHaveLength(2)
  expect(qc.getQueryData(meQueryKey)).toEqual(me)
})

test('세션 확인이 도는 동안 화면이 내려가면 소켓을 새로 열지 않는다', async () => {
  let answer: (value: unknown) => void = () => {}
  fetchMe.mockReturnValue(new Promise((resolve) => (answer = resolve)))
  const { root, close } = await mount()
  await close(4401)
  await act(async () => root.unmount())
  await act(async () => {
    answer(me)
    await vi.advanceTimersByTimeAsync(5000)
  })

  expect(FakeSocket.opened).toHaveLength(1)
})

test('열리자마자 닫히기를 되풀이하면 간격을 늘리고 연결된 것으로 치지 않는다', async () => {
  const { qc } = await mount()
  const refetch = vi.spyOn(qc, 'invalidateQueries')
  /** 서버가 거절할 때처럼 열었다가 바로 1013 으로 닫고 `ms` 를 보낸다. */
  const reject = (index: number, ms: number) =>
    act(async () => {
      FakeSocket.opened[index].onopen?.()
      FakeSocket.opened[index].onclose?.({ code: 1013 })
      await vi.advanceTimersByTimeAsync(ms)
    })

  await reject(0, 2000)
  expect(FakeSocket.opened).toHaveLength(2)
  await reject(1, 2000)
  expect(FakeSocket.opened).toHaveLength(2)
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(FakeSocket.opened).toHaveLength(3)
  expect(refetch).not.toHaveBeenCalled()
})

test('자리 잡은 연결이 끊기면 간격을 처음으로 되돌리고 놓친 것을 다시 받는다', async () => {
  const { qc } = await mount()
  const refetch = vi.spyOn(qc, 'invalidateQueries')
  const closeAfter = (index: number, openFor: number) =>
    act(async () => {
      FakeSocket.opened[index].onopen?.()
      await vi.advanceTimersByTimeAsync(openFor)
      FakeSocket.opened[index].onclose?.({ code: 1006 })
      await vi.advanceTimersByTimeAsync(2000)
    })

  await closeAfter(0, 0)
  await closeAfter(1, 0)
  expect(FakeSocket.opened).toHaveLength(2)
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(FakeSocket.opened).toHaveLength(3)

  // 실패하다가 늦게 붙었으니 처음 자리 잡은 연결이어도 그 사이 놓친 것을 받는다.
  await closeAfter(2, 1000)
  expect(FakeSocket.opened).toHaveLength(4)
  expect(refetch).toHaveBeenCalledTimes(4)
  await closeAfter(3, 1000)
  expect(refetch).toHaveBeenCalledTimes(8)
})

test('곧바로 붙은 첫 연결에는 다시 받지 않는다', async () => {
  const { qc } = await mount()
  const refetch = vi.spyOn(qc, 'invalidateQueries')
  await act(async () => {
    FakeSocket.opened[0].onopen?.()
    await vi.advanceTimersByTimeAsync(1000)
  })

  expect(refetch).not.toHaveBeenCalled()
})

test('다시 붙는 간격은 10초를 넘지 않는다', async () => {
  await mount()
  // 2, 4, 8초를 지나 상한에 닿게 한다.
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      FakeSocket.opened[index].onclose?.({ code: 1006 })
      await vi.advanceTimersByTimeAsync(10_000)
    })
  }

  expect(FakeSocket.opened).toHaveLength(5)
})

test('자리 잡기 전에 화면이 내려가면 다시 받지 않는다', async () => {
  const { qc, root } = await mount()
  const refetch = vi.spyOn(qc, 'invalidateQueries')
  // 실패가 한 번 있어야 자리 잡을 때 다시 받는다.
  await act(async () => {
    FakeSocket.opened[0].onclose?.({ code: 1006 })
    await vi.advanceTimersByTimeAsync(2000)
  })
  await act(async () => {
    FakeSocket.opened[1].onopen?.()
    root.unmount()
    await vi.advanceTimersByTimeAsync(1000)
  })

  expect(refetch).not.toHaveBeenCalled()
})
