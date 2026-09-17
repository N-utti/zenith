import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { homeKeys } from './keys'
import type { CalendarEvent, CalendarEventInput, HomeData, TodayTask } from './types'

/**
 * 홈 한 벌. 카드 다섯 개가 이 요청 하나를 나눠 쓴다.
 *
 * 전에는 카드마다 다른 경로로 받았는데(`/announcements`·`/mentions`·`/docs/recent`·
 * `/tasks/today`) 넷 다 04 에 없는 프론트 전용 경로였다. 서버는 처음부터 한 벌로 준다.
 */
export function useHome() {
  return useQuery({
    queryKey: homeKeys.home,
    queryFn: () => api<HomeData>('/me/home'),
  })
}

const todosKey = homeKeys.home

/**
 * 홈 한 벌 안의 할 일만 바꾼다.
 *
 * 캐시에 들어 있는 것은 `{items}` 가 아니라 홈 한 벌이다. 할 일만 든 객체로 덮어쓰면
 * 나머지 카드(문서·멘션·안 읽은 대화·공지)가 통째로 사라진다.
 */
function patchTodos(qc: QueryClient, change: (todos: TodayTask[]) => TodayTask[]) {
  qc.setQueryData<HomeData>(homeKeys.home, (old) =>
    old ? { ...old, todos: change(old.todos) } : old,
  )
}

/** 홈 한 벌에서 카드가 쓸 조각만 꺼낸다. 로딩·실패 상태는 그대로 물려받는다. */
function useHomeSlice<T>(pick: (data: HomeData) => T) {
  const home = useHome()
  return { ...home, data: home.data && pick(home.data) }
}

export function useAnnouncements() {
  return useHomeSlice((data) => data.posts)
}

export function useRecentDocs() {
  return useHomeSlice((data) => data.recent_docs)
}

export function useMentions() {
  return useHomeSlice((data) => data.mentions)
}

export function useUnreadChannels() {
  return useHomeSlice((data) => data.unread)
}

/**
 * 할 일 목록. 홈에서는 한 벌(`/me/home`)에 이미 실려 오므로 그걸 쓴다.
 *
 * `GET /me/todos` 는 홈 밖에서 할 일만 볼 때를 위해 서버가 따로 두고 있다. 홈에서 또 부르면
 * 같은 것을 두 번 받는다.
 */
export function useTodayTasks() {
  return useHomeSlice((data) => data.todos)
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
      patchTodos(qc, (todos) => todos.map((t) => (t.id === id ? { ...t, done } : t)))
    },
    onError: (_error, { id, done }) => {
      patchTodos(qc, (todos) => todos.map((t) => (t.id === id ? { ...t, done: !done } : t)))
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
      const removed = qc.getQueryData<HomeData>(todosKey)?.todos.find((t) => t.id === id)
      patchTodos(qc, (todos) => todos.filter((t) => t.id !== id))
      return { removed }
    },
    onError: (_error, _id, context) => {
      if (!context?.removed) return
      // 지운 줄만 제자리로. 서버 정렬이 만든 순이라 그 기준으로 다시 끼운다.
      const removed = context.removed
      patchTodos(qc, (todos) =>
        [...todos, removed].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        ),
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
