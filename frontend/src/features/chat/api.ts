import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import type { ChatChannel, ChatMessage } from './types'

/**
 * 채팅만 MSW를 거치지 않고 개발 서버로 간다 (vite 프록시). 그래서 인증도
 * 아직 토큰이 아니라 userId를 실어 보낸다. 실제 백엔드에서는 Authorization
 * 헤더에서 꺼내야 하고, 이 인자들은 사라진다.
 */
export const chatKeys = {
  channels: ['chat', 'channels'] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
}

export function useChannels() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: chatKeys.channels,
    queryFn: () => api<{ items: ChatChannel[] }>(`/chat/channels?userId=${user.id}`),
  })
}

export function useMessages(channelId: string | null) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: chatKeys.messages(channelId ?? ''),
    queryFn: () =>
      api<{ items: ChatMessage[] }>(
        `/chat/channels/${channelId}/messages?userId=${user.id}&limit=50`,
      ),
    enabled: channelId !== null,
  })
}

export function useSendMessage(channelId: string) {
  const user = useCurrentUser()
  return useMutation({
    mutationFn: (body: string) =>
      api<ChatMessage>(`/chat/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, body }),
      }),
    // 캐시 반영은 WebSocket 이벤트가 한다. 내가 보낸 것도 같은 경로로 돌아온다.
  })
}

export function useMarkRead() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      api<{ ok: true }>(`/chat/channels/${channelId}/read`, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
  })
}
