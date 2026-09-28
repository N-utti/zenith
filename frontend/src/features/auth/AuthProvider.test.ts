import { act, createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { appendMessage, getThread } from '@/features/ai/store'
import { getDraft, setDraft } from '@/features/chat/drafts'
import { docCacheUsable } from '@/features/docs/localCache'
import { AuthContext, type AuthValue } from './AuthContext'
import { AuthProvider } from './AuthProvider'

/** `/me` 를 붙잡아 두거나(부팅 중) 실패시킬 때 바꾼다. */
const me = vi.hoisted(() => ({
  answer: () => Promise.resolve<unknown>({ id: 'u2', name: '다음 사람', role: 'member' }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: (path: string) => (path === '/me' ? me.answer() : Promise.resolve(undefined)),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * 탭 사이 채널을 같은 이름의 다른 인스턴스에 곧바로 전하는 가짜로 바꾼다. Node 의 진짜
 * BroadcastChannel 은 전달 시점이 들쭉날쭉해 "안 불렸다" 를 확인할 수 없다. 보낸 인스턴스 자신은
 * 받지 않는 규약은 그대로 둔다. `AuthProvider` 가 모듈을 읽을 때 채널을 만들므로 그보다 먼저 바꾼다.
 */
vi.hoisted(() => {
  class FakeChannel extends EventTarget {
    static open = new Set<FakeChannel>()
    onmessage: ((e: MessageEvent) => void) | null = null
    name: string
    constructor(name: string) {
      super()
      this.name = name
      FakeChannel.open.add(this)
    }
    postMessage(data: unknown) {
      for (const other of FakeChannel.open) {
        if (other === this || other.name !== this.name) continue
        const event = new MessageEvent('message', { data })
        other.dispatchEvent(event)
        other.onmessage?.(event)
      }
    }
    close() {
      FakeChannel.open.delete(this)
    }
  }
  globalThis.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel
})

const realAnswer = me.answer
afterEach(() => {
  delete window.__TAURI__
  vi.unstubAllGlobals()
  me.answer = realAnswer
})

/** 다른 탭 알림을 받은 탭이 첫 화면으로 다시 열리는지 센다. */
function stubReload() {
  const replace = vi.fn()
  vi.stubGlobal('location', { ...window.location, replace })
  return replace
}

function mount() {
  const view: { auth: AuthValue | null } = { auth: null }
  function Grab() {
    view.auth = use(AuthContext)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const rendered = act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(AuthProvider, null, createElement(Grab)),
      ),
    ),
  )
  return { view, root, rendered }
}

test('로그인하면 앞사람의 쿼리 캐시·AI 대화·쓰다 만 채팅 글을 비우고, 로그인·로그아웃을 다른 탭에 알린다', async () => {
  // 앞사람이 남기고 간 것.
  appendMessage({ id: 'q', role: 'user', body: '임원 연봉 알려줘', scope: null, createdAt: '' })
  setDraft('room', '보내기 전 글')
  const before = getThread().sessionId
  // 세션 만료로 로그인 화면에 오면 캐시는 그대로 남아 있다(`dropSessionOn401`).
  const qc = new QueryClient()
  qc.setQueryData(['approvals', 'secret'], { body: '임원 결재 본문' })

  let auth: AuthValue | null = null
  function Grab() {
    auth = use(AuthContext)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(AuthProvider, null, createElement(Grab)),
      ),
    ),
  )

  // 다른 탭 자리. 이 탭의 로그인·로그아웃이 여기로 알려져야 한다.
  const otherTab = new BroadcastChannel('zenith.auth')
  const heard: unknown[] = []
  otherTab.onmessage = (e) => heard.push(e.data)

  await act(() => auth!.login('next@zenith.local', 'pw'))
  expect(getThread().messages).toEqual([])
  expect(getThread().sessionId).not.toBe(before)
  expect(getDraft('room')).toBe('')
  expect(qc.getQueryData(['approvals', 'secret'])).toBeUndefined()

  await act(() => auth!.logout())
  expect(heard).toEqual([{ userId: 'u2' }, { userId: null }])
  otherTab.close()
  act(() => root.unmount())
})

test('다른 탭에서 다른 사람이 로그인하거나 로그아웃하면 이 탭을 첫 화면으로 다시 연다', async () => {
  const reload = stubReload()
  // 이 탭의 사용자는 u2 (`/me` 목). 정해진 뒤에 보낸다.
  const { view, root, rendered } = mount()
  await rendered
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))
  await act(async () => {}) // 구독 effect 까지 돌린다
  const otherTab = new BroadcastChannel('zenith.auth')
  otherTab.postMessage({ userId: 'u2' }) // 같은 사람이 다른 탭에서 다시 로그인: 그대로 둔다
  expect(reload).not.toHaveBeenCalled()
  otherTab.postMessage({ userId: 'u3' }) // 다른 사람이 로그인
  expect(reload).toHaveBeenCalledTimes(1)
  otherTab.postMessage({ userId: null }) // 로그아웃
  expect(reload).toHaveBeenCalledTimes(2)

  otherTab.close()
  act(() => root.unmount())
})

test('첫 `/me` 를 받는 중에 알림이 오면 누구로 정해질지 모르니 다시 연다', async () => {
  const reload = stubReload()
  me.answer = () => new Promise(() => {}) // 끝나지 않는 부팅
  const { root, rendered } = mount()
  await rendered
  const otherTab = new BroadcastChannel('zenith.auth')
  otherTab.postMessage({ userId: 'u2' })
  expect(reload).toHaveBeenCalledTimes(1)
  otherTab.close()
  act(() => root.unmount())
})

test('로그인은 됐는데 `/me` 가 실패해도 다른 탭에 알린다', async () => {
  const { view, root, rendered } = mount()
  await rendered
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))
  const otherTab = new BroadcastChannel('zenith.auth')
  const heard: unknown[] = []
  otherTab.onmessage = (e) => heard.push(e.data)

  me.answer = () => Promise.reject(new Error('network'))
  await act(() => expect(view.auth!.login('b@zenith.local', 'pw')).rejects.toThrow('network'))
  expect(heard).toEqual([{ userId: '' }])
  otherTab.close()
  act(() => root.unmount())
})

/** 문서 사본 하나가 있는 브라우저. `hold` 가 풀릴 때까지 목록 조회가 끝나지 않는다. */
function stubDocCache(hold: Promise<void> = Promise.resolve()) {
  const deleted: string[] = []
  vi.stubGlobal('indexedDB', {
    databases: () => hold.then(() => [{ name: 'zenith.doc.a' }]),
    deleteDatabase: (name: string) => deleted.push(name),
  })
  return deleted
}

test('앞사람 사본은 화면이 뜨기 전에 지우고, 로그아웃은 지우지 않는다', async () => {
  let release = () => {}
  const deleted = stubDocCache(new Promise((resolve) => (release = resolve)))
  localStorage.setItem('zenith.docCacheOwner', 'u1') // 앞사람. 쿠키는 u2(`/me` 목)
  const { view, root, rendered } = mount()
  await rendered
  // 지우기가 안 끝났으면 아직 누구로도 들어가지 않는다. 문서 화면이 앞사람 사본을 열 틈이 없다.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(view.auth?.status).toBe('loading')

  release()
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))
  expect(deleted).toEqual(['zenith.doc.a'])
  expect(localStorage.getItem('zenith.docCacheOwner')).toBe('u2')

  // 못 올린 오프라인 편집이 사라지므로 로그아웃에서는 지우지 않는다.
  await act(() => view.auth!.logout())
  expect(deleted).toEqual(['zenith.doc.a'])
  act(() => root.unmount())
})

test('로그인은 됐는데 `/me` 가 실패하면 사본을 지우고 주인도 비운다', async () => {
  localStorage.setItem('zenith.docCacheOwner', 'u2')
  const deleted = stubDocCache()
  const { view, root, rendered } = mount()
  await rendered
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))
  expect(deleted).toEqual([]) // 같은 사람(u2)이라 부팅 때는 남겼다

  me.answer = () => Promise.reject(new Error('network'))
  await act(() => expect(view.auth!.login('b@zenith.local', 'pw')).rejects.toThrow('network'))
  expect(deleted).toEqual(['zenith.doc.a'])
  expect(localStorage.getItem('zenith.docCacheOwner')).toBeNull()
  act(() => root.unmount())
})

test('부팅 때 앞사람 사본을 못 지워도 들어가고, 이번 세션은 사본을 쓰지 않는다', async () => {
  vi.stubGlobal('indexedDB', {
    databases: () => Promise.reject(new Error('blocked')),
    deleteDatabase: () => {},
  })
  localStorage.setItem('zenith.docCacheOwner', 'u1') // 앞사람. 쿠키는 u2
  const { view, root, rendered } = mount()
  await rendered
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))
  expect(docCacheUsable()).toBe(false)
  expect(localStorage.getItem('zenith.docCacheOwner')).toBe('u1')
  act(() => root.unmount())
})

test('데스크톱 앱이면 로그인·로그아웃 때 알림 센터의 채팅 알림을 비운다', async () => {
  const invoke = vi.fn(() => Promise.resolve())
  window.__TAURI__ = { core: { invoke } }
  const { view, root, rendered } = mount()
  await rendered
  await vi.waitFor(() => expect(view.auth?.status).toBe('authenticated'))

  await act(() => view.auth!.login('u2@zenith.local', 'pw'))
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(() => view.auth!.logout())
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenCalledWith('clear_notifications')
  act(() => root.unmount())
})
