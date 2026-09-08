import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ChatChannel, ChatMessage } from './types'

/**
 * 채팅만 MSW를 거치지 않고 개발 서버로 간다 (vite 프록시). 누구인지는 URL·본문이 아니라
 * 세션 쿠키가 말한다(11 §7.5). 개발 릴레이(scripts/chat.js)도 실제 백엔드도 쿠키만 본다.
 */
export const chatKeys = {
  channels: ['chat', 'channels'] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
}

export function useChannels() {
  return useQuery({
    queryKey: chatKeys.channels,
    queryFn: () => api<{ items: ChatChannel[] }>('/chat/channels'),
  })
}

export function useMessages(channelId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(channelId ?? ''),
    queryFn: () => api<{ items: ChatMessage[] }>(`/chat/channels/${channelId}/messages?limit=50`),
    enabled: channelId !== null,
  })
}

export function useSendMessage(channelId: string) {
  return useMutation({
    mutationFn: (body: string) =>
      api<ChatMessage>(`/chat/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    // 캐시 반영은 WebSocket 이벤트가 한다. 내가 보낸 것도 같은 경로로 돌아온다.
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      api<{ ok: true }>(`/chat/channels/${channelId}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
  })
}
