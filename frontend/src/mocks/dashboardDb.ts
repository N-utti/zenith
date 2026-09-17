import type { TodayTask } from '@/features/home/types'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/**
 * 오늘 할 일. 백엔드 `TodoOut` 과 같은 모양이다.
 *
 * 홈의 멘션 카드가 쓰던 목 데이터는 여기 없다. 알림함(`notificationsDb`)에서 파생시킨다.
 * 같은 사건을 두 벌로 두면 알림함에서 읽음 처리를 해도 홈은 모른다.
 */
const TODAY_TASKS: TodayTask[] = [
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

/**
 * 만든 순. 백엔드 `_todos` 의 `order_by(Todo.created_at, Todo.id)` 와 같다.
 *
 * **완료 여부는 정렬에 안 들어간다.** 끝낸 할 일이 목록 중간에 그대로 남는다. 완료된 것을
 * 아래로 내리면 체크하는 순간 줄이 튀는데, 그건 서버가 하지 않는 일이라 화면에서도 하지 않는다.
 */
export function listTasks(): TodayTask[] {
  return [...TODAY_TASKS].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )
}
