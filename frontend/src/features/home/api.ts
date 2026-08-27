import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocSummary } from '@/features/docs/types'
import type { Announcement, UnreadSummary } from './types'

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements', { limit: 4 }],
    queryFn: () => api<{ items: Announcement[] }>('/announcements?limit=4'),
  })
}

export function useRecentDocs() {
  return useQuery({
    queryKey: ['documents', 'recent', { limit: 5 }],
    queryFn: () => api<{ items: DocSummary[] }>('/documents/recent?limit=5'),
  })
}

export function useUnreadChat() {
  return useQuery({
    queryKey: ['chat', 'unread'],
    queryFn: () => api<UnreadSummary>('/chat/unread'),
    // 채팅 안읽음은 자주 바뀐다. WebSocket 연동 전까지는 폴링으로 버틴다.
    refetchInterval: 60_000,
  })
}
