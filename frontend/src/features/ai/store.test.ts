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

it('저장 열쇠를 주면 세션 id 를 새로고침 뒤에도 기억하고, 새 대화·다른 대화로 옮길 때 갈아 끼운다', () => {
  localStorage.removeItem('t.session')
  const first = createThreadStore('t.session')
  // 새로고침은 모듈을 다시 만든다. 같은 열쇠로 만들면 같은 대화다.
  expect(createThreadStore('t.session').getSessionId()).toBe(first.getSessionId())
  first.reset()
  expect(localStorage.getItem('t.session')).toBe(first.getSessionId())
  first.switchTo('s-2')
  expect(createThreadStore('t.session').getSessionId()).toBe('s-2')
  // 문서 질문창은 열쇠가 없어 남기지 않는다.
  expect(createThreadStore().getSessionId()).not.toBe('s-2')
})
