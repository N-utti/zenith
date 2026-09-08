import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocSummary } from '@/features/docs/types'
import type { BoardPost } from '@/features/board/types'
import type { CalendarEvent, CalendarEventInput, Mention, TodayTask } from './types'

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements', { limit: 4 }],
    queryFn: () => api<{ items: BoardPost[] }>('/announcements?limit=4'),
  })
}

export function useRecentDocs() {
  return useQuery({
    queryKey: ['documents', 'recent', { limit: 4 }],
    queryFn: () => api<{ items: DocSummary[] }>('/documents/recent?limit=4'),
  })
}

export function useMentions() {
  return useQuery({
    queryKey: ['mentions', { limit: 3 }],
    queryFn: () => api<{ items: Mention[] }>('/mentions?limit=3'),
  })
}

const todayTasksKey = ['tasks', 'today'] as const

export function useTodayTasks() {
  return useQuery({
    queryKey: todayTasksKey,
    queryFn: () => api<{ items: TodayTask[] }>('/tasks/today'),
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api<TodayTask>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    // 체크는 즉시 반응해야 한다. 실패하면 이전 목록으로 되돌린다.
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: todayTasksKey })
      const previous = qc.getQueryData<{ items: TodayTask[] }>(todayTasksKey)
      qc.setQueryData<{ items: TodayTask[] }>(todayTasksKey, (old) =>
        old ? { items: old.items.map((t) => (t.id === id ? { ...t, done } : t)) } : old,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(todayTasksKey, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: todayTasksKey })
    },
  })
}

const eventsKey = ['events'] as const

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
