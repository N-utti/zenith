import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DocSummary } from '@/features/docs/types'
import type { Announcement, Mention, TodayTask } from './types'

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements', { limit: 4 }],
    queryFn: () => api<{ items: Announcement[] }>('/announcements?limit=4'),
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
