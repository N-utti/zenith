import { act, createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { appendMessage, getThread } from '@/features/ai/store'
import { getDraft, setDraft } from '@/features/chat/drafts'
import { AuthContext, type AuthValue } from './AuthContext'
import { AuthProvider } from './AuthProvider'

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: (path: string) =>
    Promise.resolve(path === '/me' ? { id: 'u2', name: '다음 사람', role: 'member' } : undefined),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('로그인하면 앞사람의 쿼리 캐시·AI 대화·쓰다 만 채팅 글을 비운다', async () => {
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

  await act(() => auth!.login('next@zenith.local', 'pw'))
  expect(getThread().messages).toEqual([])
  expect(getThread().sessionId).not.toBe(before)
  expect(getDraft('room')).toBe('')
  expect(qc.getQueryData(['approvals', 'secret'])).toBeUndefined()
  act(() => root.unmount())
})
