import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { docKeys } from '@/features/docs/api'
import { homeKeys } from './keys'
import type { DocSummary } from '@/features/docs/types'
import type { BoardPost } from '@/features/board/types'
import type { CalendarEvent, CalendarEventInput, Mention, TodayTask } from './types'

export function useAnnouncements() {
  return useQuery({
    queryKey: [...homeKeys.announcements, { limit: 4 }],
    queryFn: () => api<{ items: BoardPost[] }>('/announcements?limit=4'),
  })
}

export function useRecentDocs() {
  return useQuery({
    queryKey: [...docKeys.recent, { limit: 4 }],
    queryFn: () => api<{ items: DocSummary[] }>('/docs/recent?limit=4'),
  })
}

export function useMentions() {
  return useQuery({
    queryKey: [...homeKeys.mentions, { limit: 3 }],
    queryFn: () => api<{ items: Mention[] }>('/mentions?limit=3'),
  })
}

const todosKey = homeKeys.todos

export function useTodayTasks() {
  return useQuery({
    queryKey: todosKey,
    queryFn: () => api<{ items: TodayTask[] }>('/me/todos'),
  })
}

/*
 * 체크와 삭제는 즉시 반응하고, 실패하면 **그 줄만** 되돌린다.
 *
 * 목록 전체를 스냅샷으로 떠 두었다가 통째로 복원하면 두 변이가 서로를 덮는다. A 를 체크하고
 * 곧바로 B 를 지웠는데 A 만 실패하면, A 의 복원이 이미 지워진 B 를 되살린다. 한 줄짜리
 * 변경이라 역연산이 더 짧기도 하다.
 */
export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api<TodayTask>(`/me/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: todosKey })
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old ? { items: old.items.map((t) => (t.id === id ? { ...t, done } : t)) } : old,
      )
    },
    onError: (_error, { id, done }) => {
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old ? { items: old.items.map((t) => (t.id === id ? { ...t, done: !done } : t)) } : old,
      )
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: todosKey })
    },
  })
}

export function useAddTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) =>
      api<TodayTask>('/me/todos', { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: todosKey }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/me/todos/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: todosKey })
      const removed = qc
        .getQueryData<{ items: TodayTask[] }>(todosKey)
        ?.items.find((t) => t.id === id)
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old ? { items: old.items.filter((t) => t.id !== id) } : old,
      )
      return { removed }
    },
    onError: (_error, _id, context) => {
      if (!context?.removed) return
      // 지운 줄만 제자리로. 서버 정렬이 만든 순이라 그 기준으로 다시 끼운다.
      const removed = context.removed
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old
          ? {
              items: [...old.items, removed].sort(
                (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
              ),
            }
          : old,
      )
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: todosKey })
    },
  })
}

const eventsKey = homeKeys.events

/** 기간 안의 내 일정. `from`·`to` 는 ISO 날짜(양끝 포함). */
export function useMyEvents(from: string, to: string) {
  return useQuery({
    queryKey: [...eventsKey, { from, to }],
    queryFn: () => api<{ items: CalendarEvent[] }>(`/me/events?from=${from}&to=${to}`),
  })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CalendarEventInput) =>
      api<CalendarEvent>('/me/events', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eventsKey }),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/me/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eventsKey }),
  })
}
