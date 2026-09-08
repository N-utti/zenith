import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiEvents } from '@/lib/api'
import { appendMessage, getSessionId, patchMessage, uuid } from './store'
import type { AiModel, Citation } from './types'

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
 */
export function useAsk() {
  return useMutation({
    mutationFn: async ({ prompt, scope }: { prompt: string; scope: string | null }) => {
      appendMessage({
        id: uuid(),
        role: 'user',
        body: prompt,
        createdAt: new Date().toISOString(),
      })
      const answerId = uuid()
      let started = false
      const events = apiEvents('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: getSessionId(), message: prompt, scope }),
      })
      try {
        for await (const { event, data } of events) {
          if (!started) {
            // 첫 이벤트에서야 말풍선을 만든다. 그 전까지는 "생성 중" 표시가 자리를 지킨다.
            appendMessage({ id: answerId, role: 'assistant', body: '', createdAt: new Date().toISOString() })
            started = true
          }
          if (event === 'token') {
            const text = (data as { text?: unknown }).text
            if (typeof text === 'string') patchMessage(answerId, (m) => ({ body: m.body + text }))
          } else if (event === 'citations') {
            patchMessage(answerId, { citations: Array.isArray(data) ? (data as Citation[]) : [] })
          } else if (event === 'error') {
            patchMessage(answerId, { error: (data as { detail: string }).detail })
          } else if (event === 'done') {
            return
          }
        }
      } catch (error) {
        // 답변 도중 연결이 끊긴 경우. 받은 데까지는 남기고 그 자리에 사유를 단다.
        if (started) patchMessage(answerId, { error: '연결이 끊겨 답변이 중단됐습니다.' })
        throw error
      }
    },
  })
}
