import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocSummary } from '@/features/docs/types'
import type { Announcement } from './types'

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

