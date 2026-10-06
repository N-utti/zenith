import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiEvents } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { appendMessage, getSessionId, patchMessage } from './store'
import type { AiModel, Citation } from './types'

/**
 * 04 §8 `POST /ai/feedback {message_id, value: 1|-1}`. 응답은 04 에 없어 204 로 가정.
 * message_id 는 클라이언트가 만든 답변 id 다. 서버가 세션을 저장하지 않아 대응되는 행이 없다(PR 본문).
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
 * `citations` 는 본문이 끝난 뒤 한 번, `done` 으로 닫힌다. `error` 는 받은 데까지 남기고 사유를 단다.
 * `resend` 는 실패한 답변을 다시 받는 것이라 내 질문 말풍선을 또 붙이지 않는다.
 */
export function useAsk() {
  return useMutation({
    mutationFn: async ({
      prompt,
      scope,
      resend = false,
    }: {
      prompt: string
      scope: string | null
      resend?: boolean
    }) => {
      if (!resend) {
        appendMessage({
          id: uuid(),
          role: 'user',
          body: prompt,
          scope,
          createdAt: new Date().toISOString(),
        })
      }
      const answerId = uuid()
      const session = getSessionId()
      let started = false
      const events = apiEvents('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: session, message: prompt, scope }),
      })
      try {
        for await (const { event, data } of events) {
          // 답변 도중 대화가 비워졌다(새 대화·다른 사람 로그인). 남은 토큰이 새 대화에 붙으면 안 된다.
          // 루프를 빠져나가면 스트림도 닫힌다.
          if (getSessionId() !== session) return
          if (!started) {
            // 첫 이벤트에서야 말풍선을 만든다. 그 전까지는 "생성 중" 표시가 자리를 지킨다.
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
            return
          }
        }
      } catch (error) {
        // 답변 도중 연결이 끊긴 경우. 받은 데까지는 남기고 그 자리에 사유를 단다(서버가 준 사유가 있으면 그대로).
        if (started)
          patchMessage(answerId, (m) => ({ error: m.error ?? '연결이 끊겨 답변이 중단됐습니다.' }))
        throw error
      }
    },
  })
}
