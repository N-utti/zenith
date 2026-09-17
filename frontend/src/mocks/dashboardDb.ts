import type { TodayTask } from '@/features/home/types'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/**
 * 오늘 할 일. 백엔드 `TodoOut` 과 같은 모양이다.
 *
 * 홈의 멘션 카드가 쓰던 목 데이터는 여기 없다. 알림함(`notificationsDb`)에서 파생시킨다.
 * 같은 사건을 두 벌로 두면 알림함에서 읽음 처리를 해도 홈은 모른다.
 */
export const TODAY_TASKS: TodayTask[] = [
  { id: 't-1', text: '예산안 검토 후 회신', done: false, created_at: minutesAgo(300) },
  { id: 't-2', text: '근태 설계서 오픈이슈 정리', done: false, created_at: minutesAgo(200) },
  { id: 't-3', text: '주간 회의록 공유', done: true, created_at: minutesAgo(100) },
]

let nextId = 100

export function addTask(text: string): TodayTask {
  const task: TodayTask = {
    id: `t-${nextId++}`,
    text,
    done: false,
    created_at: new Date().toISOString(),
  }
  TODAY_TASKS.push(task)
  return task
}

export function findTask(id: string): TodayTask | undefined {
  return TODAY_TASKS.find((task) => task.id === id)
}

export function removeTask(id: string): boolean {
  const index = TODAY_TASKS.findIndex((task) => task.id === id)
  if (index < 0) return false
  TODAY_TASKS.splice(index, 1)
  return true
}

/** 안 끝난 것이 위, 그 안에서는 만든 순. 백엔드 `_todos` 와 같은 정렬이다. */
export function listTasks(): TodayTask[] {
  return [...TODAY_TASKS].sort(
    (a, b) => Number(a.done) - Number(b.done) || a.created_at.localeCompare(b.created_at),
  )
}
