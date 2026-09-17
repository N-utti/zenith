import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { homeKeys } from '@/features/home/keys'
import type { Notification } from './types'

export const notificationKeys = {
  list: ['notifications'] as const,
}

/**
 * 알림은 한 번만 받아 온다. 안 읽음 탭은 화면에서 거른다.
 *
 * 서버에 `?unread=1` 이 있지만 그걸 쓰면 탭마다 쿼리가 생겨, 탭을 옮길 때마다 목록이
 * 스켈레톤으로 바뀌고 한쪽만 갱신된 중간 상태에서 같은 알림의 읽음 여부가 탭마다 다르게
 * 보인다. 판정 기준(`read_at === null`)이 이미 응답에 실려 온다. 목록이 커지면 그때 붙인다.
 *
 * 프론트에서 걸러 숨기면 안 되는 것은 권한 밖 데이터다. 읽음 여부는 거기 해당하지 않는다.
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => api<{ items: Notification[] }>('/me/notifications'),
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<void>('/me/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list })
      // 홈의 멘션 카드도 같은 알림을 본다.
      void qc.invalidateQueries({ queryKey: homeKeys.mentions })
    },
  })
}
