import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Notification, NotificationFilter } from './types'

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filter: NotificationFilter) => ['notifications', filter] as const,
}

export function useNotifications(filter: NotificationFilter) {
  return useQuery({
    queryKey: notificationKeys.list(filter),
    queryFn: () =>
      api<{ items: Notification[] }>(`/me/notifications${filter === 'unread' ? '?unread=1' : ''}`),
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<void>('/me/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
      // 홈의 멘션 카드도 같은 알림을 본다.
      void qc.invalidateQueries({ queryKey: ['mentions'] })
    },
  })
}
