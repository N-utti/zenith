/**
 * 협업 공간(프로젝트 칸반보드)의 타입. 백엔드보다 먼저 만들어 손수 적었다. 04 에 아직 없다.
 * 백엔드가 들어오면 생성 타입(`Schema<'...'>`)으로 옮긴다.
 */

export interface Person {
  id: string
  name: string
}

// ponytail: 단계는 모든 프로젝트가 같은 네 칸이다. 프로젝트마다 열을 따로 두는 것은
// 팀이 다른 흐름을 실제로 요구할 때 붙인다(그때 단계가 프로젝트의 자식 목록이 된다).
export const TASK_STAGES = [
  { key: 'todo', label: '할 일' },
  { key: 'doing', label: '진행 중' },
  { key: 'review', label: '검토' },
  { key: 'done', label: '완료' },
] as const

export type TaskStage = (typeof TASK_STAGES)[number]['key']

export const TASK_PRIORITIES = [
  { key: 'high', label: '높음' },
  { key: 'normal', label: '보통' },
  { key: 'low', label: '낮음' },
] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]['key']

export const PROJECT_NAME_MAX = 80
export const PROJECT_DESCRIPTION_MAX = 500
export const TASK_TITLE_MAX = 120
export const TASK_NOTE_MAX = 2000

export interface Project {
  id: string
  name: string
  description: string
  created_by: Person
  created_at: string
  task_count: number
  done_count: number
  /** 만든 사람과 임원만 지운다. 판정은 서버가 한다. */
  can_delete: boolean
}

export interface ProjectInput {
  name: string
  description: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  stage: TaskStage
  assignee: Person | null
  /** `YYYY-MM-DD`. */
  due_date: string | null
  priority: TaskPriority
  note: string
  created_at: string
}

export interface TaskInput {
  title: string
  stage: TaskStage
  assignee_id: string | null
  due_date: string | null
  priority: TaskPriority
  note: string
}
