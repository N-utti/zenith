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
  return useQuery({ queryKey: homeKeys.home, queryFn: fetchHome })
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

/**
 * 홈 한 벌에서 카드가 쓸 조각만 구독한다.
 *
 * `select` 로 꺼내면 react-query 가 구조적 공유 뒤에 그 조각만 비교하므로, 할 일 하나를
 * 체크해도 조각이 안 바뀐 카드는 다시 그려지지 않는다. 고르는 함수는 모듈 상수여야 그 비교가
 * 산다(매 렌더 새 함수면 매번 다시 고른다).
 */
function useHomeSlice<T>(select: (data: HomeData) => T) {
  return useQuery({ queryKey: homeKeys.home, queryFn: fetchHome, select })
}

const fetchHome = () => api<HomeData>('/me/home')

const pickPosts = (data: HomeData) => data.posts
const pickRecentDocs = (data: HomeData) => data.recent_docs
const pickMentions = (data: HomeData) => data.mentions
const pickUnread = (data: HomeData) => data.unread
const pickTodos = (data: HomeData) => data.todos

export function useAnnouncements() {
  return useHomeSlice(pickPosts)
}

export function useRecentDocs() {
  return useHomeSlice(pickRecentDocs)
}

export function useMentions() {
  return useHomeSlice(pickMentions)
}

export function useUnreadChannels() {
  return useHomeSlice(pickUnread)
}

/**
 * 할 일 목록. 홈에서는 한 벌(`/me/home`)에 이미 실려 오므로 그걸 쓴다.
 *
 * `GET /me/todos` 는 홈 밖에서 할 일만 볼 때를 위해 서버가 따로 두고 있다. 홈에서 또 부르면
 * 같은 것을 두 번 받는다.
 */
export function useTodayTasks() {
  return useHomeSlice(pickTodos)
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

/** 할 일의 글자를 고친다. 체크와 같은 규약: 즉시 반영하고 실패하면 그 줄의 글자만 되돌린다. */
export function useEditTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api<TodayTask>(`/me/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
    onMutate: async ({ id, text }) => {
      await qc.cancelQueries({ queryKey: todosKey })
      const before = qc.getQueryData<HomeData>(todosKey)?.todos.find((t) => t.id === id)?.text
      patchTodos(qc, (todos) => todos.map((t) => (t.id === id ? { ...t, text } : t)))
      return { before }
    },
    onError: (_error, { id }, context) => {
      const before = context?.before
      if (before === undefined) return
      patchTodos(qc, (todos) => todos.map((t) => (t.id === id ? { ...t, text: before } : t)))
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
