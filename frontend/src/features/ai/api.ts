import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, apiEvents, type SseEvent } from '@/lib/api'
import { markOnboarding } from '@/features/home/onboarding'
import { uuid } from '@/lib/uuid'
import type { Schema } from '@/types'
import { aiThread, type ThreadStore } from './store'
import type { AiAttachment, AiEditResult, AiMessage, Citation } from './types'

/**
 * 04 §8 `POST /ai/feedback {message_id, value: 1|-1}`. 응답은 204(백엔드 #317).
 * message_id 는 `done` 이 알려 준 서버 답변 id 다(백엔드 #364). 그 id 여야 저장된 대화에 평가가 붙는다.
 * 못 받았으면 클라이언트가 만든 id 로 나가고, 그때는 평가 표에만 남는다.
 */
export function useFeedback() {
  return useMutation({
    mutationFn: ({ messageId, value }: { messageId: string; value: 1 | -1 }) =>
      api<void>('/ai/feedback', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId, value }),
      }),
  })
}

/**
 * 질문에 붙일 파일을 올린다(백엔드 #396). 서버가 평문을 뽑아 7일 둔다. 캐시할 것이 없어 react-query 를 거치지 않는다.
 * 형식·크기·보관 한도 거절은 422 이고 사유는 문자열이다.
 */
export function uploadAiAttachment(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<AiAttachment>('/ai/attachments', { method: 'POST', body: form })
}

/**
 * 올린 xlsx·docx 첨부를 지시대로 고친 새 첨부를 만든다(백엔드 #401). 원본은 그대로다.
 * 거절 사유(422·503·429)는 전부 서버 문구로 온다.
 */
export function editAiAttachment(id: string, instruction: string) {
  return api<AiEditResult>(`/ai/attachments/${id}/edit`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  })
}

/** 04 §8 `GET /ai/sessions` 항목(백엔드 #430). 내 대화만, 최근 순 50개. `title` 은 첫 질문 80자. */
export type AiSession = Schema<'SessionOut'>
type SessionDetail = Schema<'SessionDetailOut'>

export const aiSessionsKey = ['ai', 'sessions'] as const

/**
 * 내 대화 목록. 문서 질문창(`DocAskPanel`)의 대화도 섞여 온다. 서버가 가르는 필드를 주지 않아 그대로 보인다.
 * 답을 만드는 중인 대화는 `pending` 이다.
 */
export function useAiSessions() {
  return useQuery({ queryKey: aiSessionsKey, queryFn: () => api<AiSession[]>('/ai/sessions') })
}

function fromServer(m: SessionDetail['messages'][number]): AiMessage {
  return {
    id: m.id,
    serverId: m.role === 'assistant' ? m.id : undefined,
    role: m.role,
    body: m.body,
    citations: m.citations ?? undefined,
    createdAt: m.created_at,
  }
}

/** 서버가 스트림에 실어 보낸 실패(`event: error`). 끊김과 달리 다시 붙어도 같은 결과라 이어 받지 않는다. */
class AnswerError extends Error {}

const CUT = '연결이 끊겨 답변이 중단됐습니다.'

/**
 * 답변 하나를 받는 동안 붙잡는 대화. 루프는 회차(`epoch`)로 아직 자기 대화인지 본다(`store.ts`).
 * 답변 도중 대화가 바뀌었으면(새 대화·다른 대화·다른 사람 로그인) 남은 토큰이 그 대화에 붙으면 안 된다.
 * 서버는 끝까지 만들어 저장한다.
 */
interface Turn {
  store: ThreadStore
  session: string
  epoch: number
}

function turnOf(store: ThreadStore): Turn {
  const { sessionId, epoch } = store.getThread()
  return { store, session: sessionId, epoch }
}

const live = (turn: Turn) => turn.store.getThread().epoch === turn.epoch

/** 받는 일을 시작하고 끝낸다. 대화가 바뀌었으면 이미 그 대화의 것이라 건드리지 않는다. */
function settle(turn: Turn) {
  if (!live(turn)) return
  turn.store.setStatus(null)
  turn.store.setBusy(false)
}

/**
 * 답변 스트림 하나를 끝까지 받아 `answerId` 말풍선에 쌓는다. `done` 이면 true, 종료 이벤트 없이 닫히면 false.
 * 서버가 재시작되면 스트림이 `done`·`error` 없이 닫힌다(백엔드 jobs.py). 그것을 성공으로 치면 안 된다.
 * `replay` 는 이어 받기다. 서버가 처음부터 다시 보내니 첫 조각이 오면 받던 본문을 비운다.
 * 미리 지우지 않는 것은 이어 받기마저 실패할 때 받은 데까지를 남기려는 것이다.
 */
async function receive(
  turn: Turn,
  answerId: string,
  events: AsyncIterable<SseEvent>,
  replay = false,
): Promise<boolean> {
  const { appendMessage, getThread, patchMessage, setStatus } = turn.store
  let started = getThread().messages.some((m) => m.id === answerId)
  let fresh = replay
  for await (const { event, data } of events) {
    // 루프를 빠져나가면 스트림도 닫힌다.
    if (!live(turn)) return true
    if (event === 'status') {
      // 서버가 문서를 찾는 동안 보내는 진행 상황(백엔드 #366). 답변이 아니라 말풍선을 만들지 않고
      // "생성 중" 자리의 문구만 바꾼다. 모델이 글을 쓰다가 다시 찾으러 가면 말풍선 아래에 보인다.
      const text = (data as { text?: unknown }).text
      if (typeof text === 'string') setStatus(text)
      continue
    }
    // 답변이 다시 흐르면 찾는 중이 아니다. 같은 값이면 스토어가 알리지 않는다.
    setStatus(null)
    if (!started) {
      // 답변의 첫 이벤트에서야 말풍선을 만든다. 그 전까지는 "생성 중" 표시가 자리를 지킨다.
      appendMessage({
        id: answerId,
        role: 'assistant',
        body: '',
        createdAt: new Date().toISOString(),
      })
      started = true
    } else if (fresh) {
      patchMessage(answerId, { body: '', citations: undefined, error: undefined })
    }
    fresh = false
    if (event === 'token') {
      const text = (data as { text?: unknown }).text
      if (typeof text === 'string') patchMessage(answerId, (m) => ({ body: m.body + text }))
    } else if (event === 'citations') {
      patchMessage(answerId, { citations: Array.isArray(data) ? (data as Citation[]) : [] })
    } else if (event === 'error') {
      const detail = (data as { detail?: unknown }).detail
      const reason = typeof detail === 'string' ? detail : '답변을 받지 못했습니다.'
      patchMessage(answerId, { error: reason })
      // 서버는 error 뒤에 done 을 보내지 않는다. 호출자에게도 실패로 알린다(재시도 버튼).
      throw new AnswerError(reason)
    } else if (event === 'done') {
      const serverId = (data as { message_id?: unknown }).message_id
      if (typeof serverId === 'string') patchMessage(answerId, { serverId })
      // 답을 끝까지 받은 때만 친다.
      markOnboarding('ai')
      return true
    }
  }
  return false
}

/**
 * 만드는 중인 답변에 다시 붙는다(`GET /ai/sessions/{id}/stream`).
 * 404 면 그사이 끝났다. 대화를 다시 읽어 서버가 저장한 답을 쓴다. 마지막 질문이 `question` 이 아니면 답이
 * 저장되지 않은 것이다(서버 재시작). 그때는 실패로 알린다.
 * `replaceAll` 이면 다시 읽은 대화로 통째로 바꾼다(되읽기). 서버가 진행 중 표시와 저장된 답을 함께 주는
 * 틈(routers/ai.py `get_session`)에 되읽었으면 질문과 답이 이미 그려져 있어 덧붙이면 둘이 된다.
 * 질문을 보낸 쪽은 답만 바꾼다. 서버에 없는 지난 실패 말풍선이 사라지지 않게.
 *
 * ponytail: 저장된 답이 이 질문의 것인지는 질문 글로만 가른다. 같은 질문을 연달아 했는데 뒤의 것만 사라지면
 * 앞 답을 붙인다. 서버가 답과 요청을 잇는 id 를 `done` 에서만 준다.
 */
async function resume(turn: Turn, answerId: string, question: string, replaceAll = false) {
  const { appendMessage, getThread, patchMessage, setMessages } = turn.store
  try {
    const events = apiEvents(`/ai/sessions/${turn.session}/stream`)
    if (await receive(turn, answerId, events, true)) return
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error
    const notSaved = new Error('답변이 저장되지 않았습니다. 다시 시도해 주세요.', { cause: error })
    const detail = await api<SessionDetail>(`/ai/sessions/${turn.session}`).catch((e: unknown) => {
      // 질문이 서버에 닿기 전에 끊겼으면 대화도 없다.
      throw e instanceof ApiError && e.status === 404 ? notSaved : e
    })
    if (!live(turn)) return
    const [asked, answered] = detail.messages.slice(-2)
    const saved =
      asked?.role === 'user' && asked.body === question && answered?.role === 'assistant'
    if (replaceAll) setMessages(detail.messages.map(fromServer))
    if (!saved) throw notSaved
    if (!replaceAll) {
      const answer = { ...fromServer(answered), id: answerId, error: undefined }
      if (getThread().messages.some((m) => m.id === answerId)) patchMessage(answerId, answer)
      else appendMessage(answer)
    }
    markOnboarding('ai')
    return
  }
  throw new Error(CUT)
}

/**
 * 받다가 끊기면(연결 실패·종료 이벤트 없이 닫힘) 한 번 이어 받는다. 서버는 연결과 상관없이 답을 끝까지 만든다(백엔드 #430).
 * HTTP 오류(409·422·429)와 서버가 보낸 `error` 는 이어 받아도 같으니 그대로 던진다.
 * 그 사이 대화가 바뀌었으면 조용히 끝낸다. 다른 대화의 실패가 지금 대화에 뜨면 안 된다.
 */
async function follow(
  turn: Turn,
  answerId: string,
  question: string,
  events: AsyncIterable<SseEvent>,
) {
  try {
    if (await receive(turn, answerId, events)) return
  } catch (error) {
    if (!live(turn)) return
    if (error instanceof ApiError || error instanceof AnswerError) throw error
  }
  if (!live(turn)) return
  try {
    await resume(turn, answerId, question)
  } catch (error) {
    if (!live(turn)) return
    // 받은 데까지 남기고 그 자리에 사유를 단다. 말풍선이 없으면 `AiPage` 가 입력창 위에 보인다.
    // 연결 실패(fetch 의 TypeError)는 브라우저 문구라 우리 문구로 바꾼다.
    const reason = error instanceof Error && !(error instanceof TypeError) ? error.message : CUT
    turn.store.patchMessage(answerId, (m) => ({ error: m.error ?? reason }))
    throw new Error(reason, { cause: error })
  }
}

/**
 * 04 §8 `POST /ai/chat`. 내 질문은 즉시 붙이고, 답변은 `token` 이 오는 대로 자라난다.
 * 그보다 먼저 `status` 가 올 수 있다(서버가 문서를 찾는 중).
 * `citations` 는 본문이 끝난 뒤 한 번, `done` 으로 닫힌다. `error` 는 받은 데까지 남기고 사유를 단다.
 * `resend` 는 실패한 답변을 다시 받는 것이라 내 질문 말풍선을 또 붙이지 않는다.
 * 대화는 `store` 에 쌓는다. 기본은 `/ai` 의 대화이고, 문서 질문창은 문서마다 따로 준다.
 * 화면을 떠나도 이 루프는 끝까지 돈다. 연결이 끊겨도 서버는 답을 끝까지 만들어 저장한다(백엔드 #430).
 */
export function useAsk(store: ThreadStore = aiThread) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      prompt,
      scope,
      docs = [],
      attachments = [],
      resend = false,
    }: {
      prompt: string
      scope: string | null
      /** 본문 전체를 근거로 넣을 문서 id(백엔드 #394). 폴더 범위와 같이 보낼 수 있다. */
      docs?: string[]
      /** `uploadAiAttachment` 로 올린 첨부 id(백엔드 #396). */
      attachments?: string[]
      resend?: boolean
    }) => {
      if (!resend) {
        store.appendMessage({
          id: uuid(),
          role: 'user',
          body: prompt,
          scope,
          docs,
          attachments,
          createdAt: new Date().toISOString(),
        })
      }
      const turn = turnOf(store)
      const body: Schema<'ChatIn'> = {
        session_id: turn.session,
        message: prompt,
        scope,
        docs,
        attachments,
      }
      store.setBusy(true)
      try {
        await follow(
          turn,
          uuid(),
          prompt,
          apiEvents('/ai/chat', { method: 'POST', body: JSON.stringify(body) }),
        )
      } finally {
        settle(turn)
      }
    },
    // 새 대화가 목록에 생기고, 방금 물은 대화가 맨 위로 온다.
    onSettled: () => qc.invalidateQueries({ queryKey: aiSessionsKey }),
  })
}

/**
 * 서버에서 대화를 되읽는다(`GET /ai/sessions/{id}`, 백엔드 #430). 새로고침 뒤나 목록에서 다른 대화를 골랐을 때.
 * 답을 만드는 중이면(`pending`) 그 질문을 내 말풍선으로 그리고 이어 받는다.
 * 아직 묻지 않은 새 대화는 서버에 없어 404 다. 빈 채로 둔다.
 * 이어 받다 실패하면 다시 읽어 서버에 남은 대로 그리고 실패로 알린다.
 * 이 탭이 이미 받는 중이면 하지 않는다. 받는 루프가 스토어를 채우고 있다.
 */
export async function restoreThread(store: ThreadStore = aiThread) {
  if (store.getThread().busy) return
  const turn = turnOf(store)
  const load = async () => {
    try {
      const detail = await api<SessionDetail>(`/ai/sessions/${turn.session}`)
      if (live(turn)) store.setMessages(detail.messages.map(fromServer))
      return detail
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }
  store.setBusy(true)
  try {
    const detail = await load()
    if (!detail?.pending || !live(turn)) return
    const { message, started_at } = detail.pending
    store.appendMessage({ id: uuid(), role: 'user', body: message, createdAt: started_at })
    try {
      await resume(turn, uuid(), message, true)
    } catch (error) {
      if (!live(turn)) return
      await load()
      throw error
    }
  } finally {
    settle(turn)
  }
}
