import { beforeEach, expect, it } from 'vitest'
import { appendMessage, getThread, removeMessage, resetThread } from './store'

beforeEach(() => resetThread())

it('removeMessage 는 그 id 만 지우고 나머지 순서와 세션을 유지한다', () => {
  const session = getThread().sessionId
  appendMessage({ id: 'q', role: 'user', body: '질문', scope: 'hr', createdAt: '' })
  appendMessage({ id: 'a', role: 'assistant', body: '답', error: '실패', createdAt: '' })
  removeMessage('a')
  expect(getThread().messages.map((m) => m.id)).toEqual(['q'])
  expect(getThread().messages[0].scope).toBe('hr')
  expect(getThread().sessionId).toBe(session)
})

it('resetThread 는 새 세션 id 를 만든다', () => {
  const before = getThread().sessionId
  resetThread()
  expect(getThread().sessionId).not.toBe(before)
})
