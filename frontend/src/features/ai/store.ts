import { useSyncExternalStore } from 'react'
import { uuid } from '@/lib/uuid'
import type { AiMessage } from './types'

/**
 * 화면의 대화. 서버(04 §8)가 `session_id` 별로 대화를 저장하고 되읽게 해 준다(백엔드 #430).
 * 페이지를 떠났다 와도 남도록 모듈 상태로 두고, 새로고침하면 `/ai` 가 서버에서 다시 읽는다(`restoreThread`).
 * 그래서 `/ai` 의 대화는 세션 id 만 localStorage 에 둔다. 본문과 근거 인용문은 등급별로 다른 내용이라 남기지 않는다.
 * 로그인할 때 비운다(`AuthProvider`). 새 세션 id 로 덮으니 앞사람의 대화를 다시 읽지 않는다(남의 것은 서버도 404).
 * 문서 질문창의 대화(`DocAskPanel`)는 따로 만들어 그 화면과 함께 비운다. 사람이 바뀌면 `RequireAuth` 가 그 화면을 내린다.
 */
interface Thread {
  sessionId: string
  messages: AiMessage[]
  /** 답변이 흐르지 않는 동안 서버가 알려 준 진행 상황("문서를 찾는 중"). 없으면 null. */
  status: string | null
  /**
   * 이 탭이 답변을 받거나 대화를 되읽는 중. 화면을 떠났다 와도 받는 루프는 계속 도니, 요청 상태가 아니라 여기서 본다.
   * 서버는 같은 대화에 앞 답이 끝나기 전에 또 보내면 409 다.
   */
  busy: boolean
  /**
   * 대화를 옮길 때마다(새 대화·다른 대화) 오른다. 받는 루프는 이것으로 아직 자기 대화인지 본다.
   * 세션 id 로 보면 A 에서 다른 대화로 갔다가 A 로 돌아왔을 때 옛 루프가 되살아나 말풍선이 둘이 된다.
   */
  epoch: number
}

function load(key: string | undefined): string {
  if (!key) return uuid()
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 창 등)이면 새로고침에 대화를 못 되찾을 뿐이다.
  }
  return save(key, uuid())
}

function save(key: string | undefined, sessionId: string): string {
  if (key)
    try {
      localStorage.setItem(key, sessionId)
    } catch {
      // `load` 와 같다.
    }
  return sessionId
}

/**
 * 대화 하나의 저장소. `/ai` 의 대화(아래 기본값)와 문서마다 여는 질문창(`DocAskPanel`)이 따로 쓴다.
 * `storageKey` 를 주면 세션 id 를 새로고침 뒤에도 기억한다.
 */
export function createThreadStore(storageKey?: string) {
  let thread: Thread = {
    sessionId: load(storageKey),
    messages: [],
    status: null,
    busy: false,
    epoch: 0,
  }
  const enter = (sessionId: string) =>
    set({
      sessionId: save(storageKey, sessionId),
      messages: [],
      status: null,
      busy: false,
      epoch: thread.epoch + 1,
    })
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
    /** 서버에서 되읽은 대화로 바꾼다. */
    setMessages: (messages: AiMessage[]) => set({ ...thread, messages }),
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
    setBusy: (busy: boolean) => {
      if (thread.busy !== busy) set({ ...thread, busy })
    },
    /** 다른 대화로 옮긴다. 비운 채로 옮기고 내용은 `restoreThread` 가 채운다. 받던 답변은 다음 조각에서 닫힌다. */
    switchTo: (sessionId: string) => enter(sessionId),
    /** 새 대화. 서버에 지우는 경로가 없어 앞 대화는 서버에 그대로 남는다(대화 목록에 보인다). */
    reset: () => enter(uuid()),
  }
}

export type ThreadStore = ReturnType<typeof createThreadStore>

/** `/ai` 화면의 대화. */
export const aiThread = createThreadStore('zenith.aiSession')
export const {
  useThread,
  getThread,
  getSessionId,
  switchTo,
  appendMessage,
  patchMessage,
  removeMessage,
  setStatus,
  reset: resetThread,
} = aiThread
