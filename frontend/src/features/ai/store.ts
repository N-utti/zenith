import { useSyncExternalStore } from 'react'
import { uuid } from '@/lib/uuid'
import type { AiMessage } from './types'

/**
 * 화면의 대화는 클라이언트에만 있다. 서버(04 §8)는 `session_id` 별로 대화를 저장해 앞선 대화를
 * 이어 보내지만(백엔드 #364) 되읽는 API 는 없다.
 * 페이지를 떠났다 와도 남도록 모듈 상태로 두되, 새로고침이면 사라지고 로그인할 때 비운다
 * (`AuthProvider`). 근거 인용문이 등급별로 다른 내용이라 localStorage 에 남기지 않는다.
 *
 * ponytail: 대화 내역 조회가 백엔드에 생기면 이 파일이 그 API 로 바뀐다.
 */
interface Thread {
  sessionId: string
  messages: AiMessage[]
  /** 답변 말풍선이 생기기 전에 서버가 알려 준 진행 상황("문서를 찾는 중"). 없으면 null. */
  status: string | null
}

let thread: Thread = { sessionId: uuid(), messages: [], status: null }
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function useThread(): Thread {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => thread,
  )
}

/** 구독 없이 읽는다. 토큰마다 재렌더될 이유가 없는 곳(mutationFn·테스트)에서 쓴다. */
export function getThread(): Thread {
  return thread
}

export function getSessionId(): string {
  return thread.sessionId
}

export function appendMessage(message: AiMessage) {
  thread = { ...thread, messages: [...thread.messages, message] }
  emit()
}

export function patchMessage(
  id: string,
  patch: Partial<AiMessage> | ((m: AiMessage) => Partial<AiMessage>),
) {
  thread = {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m,
    ),
  }
  emit()
}

export function removeMessage(id: string) {
  thread = { ...thread, messages: thread.messages.filter((m) => m.id !== id) }
  emit()
}

export function setStatus(status: string | null) {
  if (thread.status === status) return
  thread = { ...thread, status }
  emit()
}

export function resetThread() {
  thread = { sessionId: uuid(), messages: [], status: null }
  emit()
}
