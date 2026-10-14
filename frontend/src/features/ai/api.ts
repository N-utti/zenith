import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiEvents } from '@/lib/api'
import { markOnboarding } from '@/features/home/onboarding'
import { uuid } from '@/lib/uuid'
import type { Schema } from '@/types'
import { aiThread, type ThreadStore } from './store'
import type { AiModel, Citation } from './types'

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

export function useAiModels() {
  return useQuery({
    queryKey: ['ai', 'models'],
    queryFn: () => api<AiModel[]>('/ai/models'),
    // 공급자 모델 목록은 세션 중에 바뀌지 않는다.
    staleTime: Infinity,
  })
}

/**
 * 04 §8 `POST /ai/chat`. 내 질문은 즉시 붙이고, 답변은 `token` 이 오는 대로 자라난다.
 * 그보다 먼저 `status` 가 올 수 있다(서버가 문서를 찾는 중).
 * `citations` 는 본문이 끝난 뒤 한 번, `done` 으로 닫힌다. `error` 는 받은 데까지 남기고 사유를 단다.
 * `resend` 는 실패한 답변을 다시 받는 것이라 내 질문 말풍선을 또 붙이지 않는다.
 * 대화는 `store` 에 쌓는다. 기본은 `/ai` 의 대화이고, 문서 질문창은 문서마다 따로 준다.
 */
export function useAsk(store: ThreadStore = aiThread) {
  const { appendMessage, getSessionId, patchMessage, setStatus } = store
  return useMutation({
    mutationFn: async ({
      prompt,
      scope,
      docs = [],
      resend = false,
    }: {
      prompt: string
      scope: string | null
      /** 본문 전체를 근거로 넣을 문서 id(백엔드 #394). 폴더 범위와 같이 보낼 수 있다. */
      docs?: string[]
      resend?: boolean
    }) => {
      if (!resend) {
        appendMessage({
          id: uuid(),
          role: 'user',
          body: prompt,
          scope,
          docs,
          createdAt: new Date().toISOString(),
        })
      }
      const answerId = uuid()
      const session = getSessionId()
      let started = false
      // 첨부 읽기(백엔드 #396)는 화면이 아직 없어 빈 목록이다.
      const body: Schema<'ChatIn'> = {
        session_id: session,
        message: prompt,
        scope,
        docs,
        attachments: [],
      }
      const events = apiEvents('/ai/chat', { method: 'POST', body: JSON.stringify(body) })
      try {
        for await (const { event, data } of events) {
          // 답변 도중 대화가 비워졌다(새 대화·다른 사람 로그인). 남은 토큰이 새 대화에 붙으면 안 된다.
          // 루프를 빠져나가면 스트림도 닫힌다.
          if (getSessionId() !== session) return
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
          }
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
            throw new Error(reason)
          } else if (event === 'done') {
            const serverId = (data as { message_id?: unknown }).message_id
            if (typeof serverId === 'string') patchMessage(answerId, { serverId })
            // 답을 끝까지 받은 때만 친다. 화면을 떠나도 이 루프는 끝까지 돈다.
            markOnboarding('ai')
            return
          }
        }
      } catch (error) {
        // 답변 도중 연결이 끊긴 경우. 받은 데까지는 남기고 그 자리에 사유를 단다(서버가 준 사유가 있으면 그대로).
        if (started)
          patchMessage(answerId, (m) => ({ error: m.error ?? '연결이 끊겨 답변이 중단됐습니다.' }))
        throw error
      } finally {
        // 대화가 비워졌으면 이미 새 대화의 것이라 건드리지 않는다.
        if (getSessionId() === session) setStatus(null)
      }
    },
  })
}
