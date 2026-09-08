import { useSyncExternalStore } from 'react'
import type { AiMessage } from './types'

/**
 * 대화는 클라이언트에만 있다. 서버(04 §8)는 `session_id` 를 받기만 하고 저장하지 않는다.
 * 페이지를 떠났다 와도 남도록 모듈 상태로 두되, 새로고침이면 사라진다. 근거 인용문이 등급별로
 * 다른 내용이라 localStorage 에 남기지 않는다.
 *
 * ponytail: 세션 저장이 백엔드에 생기면 이 파일이 `GET /ai/sessions/{id}` 로 바뀐다.
 */
interface Thread {
  sessionId: string
  messages: AiMessage[]
}

/**
 * `crypto.randomUUID` 는 보안 컨텍스트(https·localhost) 전용이다. 파일럿은 caddy(TLS) 전까지 평문
 * http 라(infra/README) LAN 주소로 열면 없다. 서버가 `session_id` 를 uuid 로 파싱하므로 모양은 v4 로 맞춘다.
 */
export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let thread: Thread = { sessionId: uuid(), messages: [] }
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

/** 구독 없이 읽는다. 토큰마다 재렌더될 이유가 없는 곳(mutationFn)에서 쓴다. */
export function getSessionId(): string {
  return thread.sessionId
}

export function appendMessage(message: AiMessage) {
  thread = { ...thread, messages: [...thread.messages, message] }
  emit()
}

export function patchMessage(id: string, patch: Partial<AiMessage> | ((m: AiMessage) => Partial<AiMessage>)) {
  thread = {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m,
    ),
  }
  emit()
}

export function resetThread() {
  thread = { sessionId: uuid(), messages: [] }
  emit()
}
