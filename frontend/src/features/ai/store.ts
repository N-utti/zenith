import { useSyncExternalStore } from 'react'
import { uuid } from '@/lib/uuid'
import type { AiMessage } from './types'

/**
 * 화면의 대화는 클라이언트에만 있다. 서버(04 §8)는 `session_id` 별로 대화를 저장해 앞선 대화를
 * 이어 보내지만(백엔드 #364) 되읽는 API 는 없다.
 * 페이지를 떠났다 와도 남도록 모듈 상태로 두되, 새로고침이면 사라지고 로그인할 때 비운다
 * (`AuthProvider`). 근거 인용문이 등급별로 다른 내용이라 localStorage 에 남기지 않는다.
 * 문서 질문창의 대화(`DocAskPanel`)는 따로 만들어 그 화면과 함께 비운다. 사람이 바뀌면 `RequireAuth` 가 그 화면을 내린다.
 *
 * ponytail: 대화 내역 조회가 백엔드에 생기면 이 파일이 그 API 로 바뀐다.
 */
interface Thread {
  sessionId: string
  messages: AiMessage[]
  /** 답변이 흐르지 않는 동안 서버가 알려 준 진행 상황("문서를 찾는 중"). 없으면 null. */
  status: string | null
}

/** 대화 하나의 저장소. `/ai` 의 대화(아래 기본값)와 문서마다 여는 질문창(`DocAskPanel`)이 따로 쓴다. */
export function createThreadStore() {
  let thread: Thread = { sessionId: uuid(), messages: [], status: null }
  const listeners = new Set<() => void>()
  const set = (next: Thread) => {
    thread = next
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    useThread: (): Thread => useSyncExternalStore(subscribe, () => thread),
    /** 구독 없이 읽는다. 토큰마다 재렌더될 이유가 없는 곳(mutationFn·테스트)에서 쓴다. */
    getThread: (): Thread => thread,
    getSessionId: (): string => thread.sessionId,
    appendMessage: (message: AiMessage) =>
      set({ ...thread, messages: [...thread.messages, message] }),
    patchMessage: (
      id: string,
      patch: Partial<AiMessage> | ((m: AiMessage) => Partial<AiMessage>),
    ) =>
      set({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m,
        ),
      }),
    removeMessage: (id: string) =>
      set({ ...thread, messages: thread.messages.filter((m) => m.id !== id) }),
    setStatus: (status: string | null) => {
      if (thread.status !== status) set({ ...thread, status })
    },
    reset: () => set({ sessionId: uuid(), messages: [], status: null }),
  }
}

export type ThreadStore = ReturnType<typeof createThreadStore>

/** `/ai` 화면의 대화. */
export const aiThread = createThreadStore()
export const {
  useThread,
  getThread,
  getSessionId,
  appendMessage,
  patchMessage,
  removeMessage,
  setStatus,
  reset: resetThread,
} = aiThread
