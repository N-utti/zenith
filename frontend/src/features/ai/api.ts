import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AiMessage, AiMeta } from './types'

const conversationKey = ['ai', 'conversation'] as const

export function useAiMeta() {
  return useQuery({
    queryKey: ['ai', 'meta'],
    queryFn: () => api<AiMeta>('/ai/meta'),
    // 모델·지식 소스 목록은 세션 중에 바뀌지 않는다.
    staleTime: Infinity,
  })
}

export function useConversation() {
  return useQuery({
    queryKey: conversationKey,
    queryFn: () => api<{ items: AiMessage[] }>('/ai/conversation'),
  })
}

export function useAsk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prompt: string) =>
      api<{ items: AiMessage[] }>('/ai/messages', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      }),
    // 내 질문은 즉시 붙인다. 답변을 기다리는 동안 화면이 멈춘 것처럼 보이면 안 된다.
    onMutate: async (prompt) => {
      await qc.cancelQueries({ queryKey: conversationKey })
      const previous = qc.getQueryData<{ items: AiMessage[] }>(conversationKey)
      qc.setQueryData<{ items: AiMessage[] }>(conversationKey, (old) => ({
        items: [
          ...(old?.items ?? []),
          {
            id: `pending-${Date.now()}`,
            role: 'user',
            body: prompt,
            createdAt: new Date().toISOString(),
          },
        ],
      }))
      return { previous }
    },
    onError: (_error, _prompt, context) => {
      if (context?.previous) qc.setQueryData(conversationKey, context.previous)
    },
    onSuccess: (data) => {
      qc.setQueryData(conversationKey, data)
    },
  })
}

export function useResetConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ items: AiMessage[] }>('/ai/conversation', { method: 'DELETE' }),
    onSuccess: (data) => {
      qc.setQueryData(conversationKey, data)
    },
  })
}
