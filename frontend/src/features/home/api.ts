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

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api<TodayTask>(`/me/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    // 체크는 즉시 반응해야 한다. 실패하면 이전 목록으로 되돌린다.
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: todosKey })
      const previous = qc.getQueryData<{ items: TodayTask[] }>(todosKey)
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old ? { items: old.items.map((t) => (t.id === id ? { ...t, done } : t)) } : old,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(todosKey, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: todosKey })
    },
  })
}

/** 백엔드 `TodoCreateIn.text` 의 제약(`NonBlank`). */
export const TODO_TEXT_MAX = 200

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
    // 지우는 것도 즉시 반응한다. 목록에서 한 줄 사라지는 게 전부라 되돌리기도 쉽다.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: todosKey })
      const previous = qc.getQueryData<{ items: TodayTask[] }>(todosKey)
      qc.setQueryData<{ items: TodayTask[] }>(todosKey, (old) =>
        old ? { items: old.items.filter((t) => t.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) qc.setQueryData(todosKey, context.previous)
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
