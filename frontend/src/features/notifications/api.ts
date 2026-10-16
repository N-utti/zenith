import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { homeKeys } from '@/features/home/keys'
import type { Notification } from './types'
import { countUnread } from './view'

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
const listQuery = {
  queryKey: notificationKeys.list,
  queryFn: () => api<{ items: Notification[] }>('/me/notifications'),
}

export function useNotifications() {
  return useQuery(listQuery)
}

/**
 * 안 읽은 알림 수. 모바일 탭의 점이 쓴다. 알림함과 캐시를 같이 써서 같은
 * 순간에는 요청이 하나다. 다만 배지가 늘 떠 있어 이 목록은 이제 어느 화면에서나 받아 온다.
 *
 * ponytail: 서버가 최근 50건만 주므로 그보다 많이 쌓이면 50 에서 멈춘다. 15명 규모에서는
 * 닿지 않는다. 닿으면 서버에 개수 경로를 요청한다.
 */
export function useUnreadNotificationCount(): number {
  const { data } = useQuery({ ...listQuery, select: (page) => countUnread(page.items) })
  return data ?? 0
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<void>('/me/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list })
      // 홈의 멘션 카드도 같은 알림을 본다.
      void qc.invalidateQueries({ queryKey: homeKeys.home })
    },
  })
}

/**
 * 알림을 지운다(백엔드 #276). 읽음 처리와 같은 모양(`ids` 를 본문으로)이다. 하나를 지울 때도 이
 * 경로다. 서버는 내 알림만 지우고 남의 것이나 없는 id 는 조용히 건너뛴다.
 *
 * 바로 반영하지 않고 목록을 다시 받는다. 실패해도 다시 받는다. 일부만 지워진 채 실패했을 수 있다.
 */
export function useDeleteNotifications() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<void>('/me/notifications/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list })
      // 홈의 멘션 카드도 같은 알림을 본다.
      void qc.invalidateQueries({ queryKey: homeKeys.home })
    },
  })
}
