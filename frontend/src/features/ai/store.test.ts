import { beforeEach, expect, it } from 'vitest'
import { appendMessage, createThreadStore, getThread, removeMessage, resetThread } from './store'

beforeEach(() => resetThread())

it('removeMessage 는 그 id 만 지우고 나머지 순서와 세션을 유지한다', () => {
  const session = getThread().sessionId
  appendMessage({ id: 'q', role: 'user', body: '질문', scope: 'f-1', createdAt: '' })
  appendMessage({ id: 'a', role: 'assistant', body: '답', error: '실패', createdAt: '' })
  removeMessage('a')
  expect(getThread().messages.map((m) => m.id)).toEqual(['q'])
  expect(getThread().messages[0].scope).toBe('f-1')
  expect(getThread().sessionId).toBe(session)
})

it('resetThread 는 새 세션 id 를 만든다', () => {
  const before = getThread().sessionId
  resetThread()
  expect(getThread().sessionId).not.toBe(before)
})

it('따로 만든 대화(문서 질문창)는 /ai 의 대화와 섞이지 않는다', () => {
  const doc = createThreadStore()
  doc.appendMessage({ id: 'd', role: 'user', body: '이 문서', scope: 'doc:x', createdAt: '' })
  expect(getThread().messages).toEqual([])
  expect(doc.getSessionId()).not.toBe(getThread().sessionId)
  resetThread()
  expect(doc.getThread().messages.map((m) => m.id)).toEqual(['d'])
})
