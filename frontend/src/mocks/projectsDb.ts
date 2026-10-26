import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  TASK_NOTE_MAX,
  TASK_PRIORITIES,
  TASK_STAGES,
  TASK_TITLE_MAX,
  type Person,
  type Project,
  type ProjectInput,
  type Task,
  type TaskInput,
} from '@/features/projects/types'
import { toISODate } from '@/lib/datetime'
import type { User } from '@/types'
import { findAccount } from './adminDb'

/** 실패는 결재·CRM 목과 같은 모양이다. 핸들러가 그대로 응답으로 바꾼다. */
type Failure = { error: string; status: number; code: string }

const fail = (status: number, code: string, error: string): Failure => ({ error, status, code })
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} 찾을 수 없습니다.`)
const invalid = (error: string) => fail(422, 'VALIDATION', error)

interface ProjectRow {
  id: string
  name: string
  description: string
  created_by: string
  created_at: string
}

type TaskRow = Omit<Task, 'assignee'> & { assignee_id: string | null }

const DAY = 86_400_000
const day = (offset: number) => toISODate(new Date(Date.now() + offset * DAY))
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const PROJECTS: ProjectRow[] = [
  {
    id: 'pj-1',
    name: '제니스 파일럿 도입',
    description: '전 직원 계정 발급부터 기존 자료 이관까지.',
    created_by: 'u-5',
    created_at: ago(20),
  },
  {
    id: 'pj-2',
    name: '사무실 이전',
    description: '',
    created_by: 'u-4',
    created_at: ago(6),
  },
]

const seed = (
  id: string,
  project_id: string,
  title: string,
  stage: Task['stage'],
  assignee_id: string | null,
  start: number | null,
  due: number | null,
  priority: Task['priority'] = 'normal',
): TaskRow => ({
  id,
  project_id,
  title,
  stage,
  assignee_id,
  start_date: start === null ? null : day(start),
  due_date: due === null ? null : day(due),
  priority,
  note: '',
  created_at: ago(5),
})

const TASKS: TaskRow[] = [
  seed('tk-1', 'pj-1', '계정 일괄 발급', 'done', 'u-5', -12, -7),
  seed('tk-2', 'pj-1', '팀별 사용 교육 일정 잡기', 'doing', 'u-4', -2, 3, 'high'),
  seed('tk-3', 'pj-1', '공유 폴더 자료 이관', 'review', 'u-5', -6, -1, 'high'),
  seed('tk-4', 'pj-1', '결재 서식 점검', 'todo', null, 7, 14),
  seed('tk-5', 'pj-1', '사용 설문 만들기', 'todo', 'u-4', null, null, 'low'),
  seed('tk-6', 'pj-2', '이사 업체 견적 받기', 'doing', 'u-4', -3, 2),
  seed('tk-7', 'pj-2', '인터넷 회선 이전 신청', 'todo', null, null, 9),
]

let serial = 100
const nextId = (prefix: string) => `${prefix}-${++serial}`

const person = (id: string): Person => ({ id, name: findAccount(id)?.name ?? '' })

function toProject(row: ProjectRow, user: User): Project {
  const tasks = TASKS.filter((t) => t.project_id === row.id)
  return {
    ...row,
    created_by: person(row.created_by),
    task_count: tasks.length,
    done_count: tasks.filter((t) => t.stage === 'done').length,
    can_delete: row.created_by === user.id || user.role === 'exec',
  }
}

function toTask({ assignee_id, ...row }: TaskRow): Task {
  return { ...row, assignee: assignee_id ? person(assignee_id) : null }
}

const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))

/** 넘어온 칸만 본다. 통과하면 다듬은 값을, 아니면 실패를 돌려준다. */
function cleanProject(input: Partial<ProjectInput>): Partial<ProjectInput> | Failure {
  const out: Partial<ProjectInput> = {}
  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name) return invalid('프로젝트 이름을 적어 주세요.')
    if (name.length > PROJECT_NAME_MAX) {
      return invalid(`프로젝트 이름은 ${PROJECT_NAME_MAX}자까지입니다.`)
    }
    out.name = name
  }
  if (input.description !== undefined) {
    const description = String(input.description).trim()
    if (description.length > PROJECT_DESCRIPTION_MAX) {
      return invalid(`설명은 ${PROJECT_DESCRIPTION_MAX}자까지입니다.`)
    }
    out.description = description
  }
  return out
}

function cleanTask(input: Partial<TaskInput>): Partial<TaskInput> | Failure {
  const out: Partial<TaskInput> = {}
  if (input.title !== undefined) {
    const title = String(input.title).trim()
    if (!title) return invalid('업무 제목을 적어 주세요.')
    if (title.length > TASK_TITLE_MAX) return invalid(`업무 제목은 ${TASK_TITLE_MAX}자까지입니다.`)
    out.title = title
  }
  if (input.stage !== undefined) {
    if (!TASK_STAGES.some((s) => s.key === input.stage)) return invalid('없는 단계입니다.')
    out.stage = input.stage
  }
  if (input.priority !== undefined) {
    if (!TASK_PRIORITIES.some((p) => p.key === input.priority)) return invalid('없는 중요도입니다.')
    out.priority = input.priority
  }
  if (input.assignee_id !== undefined) {
    if (input.assignee_id !== null) {
      const account = findAccount(String(input.assignee_id))
      if (!account || !account.active) return invalid('담당자로 지정할 수 없는 사람입니다.')
    }
    out.assignee_id = input.assignee_id
  }
  if (input.start_date !== undefined) {
    if (input.start_date !== null && !isDate(String(input.start_date))) {
      return invalid('시작일이 올바르지 않습니다.')
    }
    out.start_date = input.start_date
  }
  if (input.due_date !== undefined) {
    if (input.due_date !== null && !isDate(String(input.due_date))) {
      return invalid('마감일이 올바르지 않습니다.')
    }
    out.due_date = input.due_date
  }
  if (input.note !== undefined) {
    const note = String(input.note).trim()
    if (note.length > TASK_NOTE_MAX) return invalid(`메모는 ${TASK_NOTE_MAX}자까지입니다.`)
    out.note = note
  }
  return out
}

/** 최근에 만든 것이 위. 전 직원이 모든 프로젝트를 본다. */
export function listProjects(user: User): Project[] {
  return [...PROJECTS]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row) => toProject(row, user))
}

export function getProject(user: User, id: string): Project | Failure {
  const row = PROJECTS.find((p) => p.id === id)
  return row ? toProject(row, user) : notFound('프로젝트를')
}

export function createProject(user: User, input: ProjectInput): Project | Failure {
  const clean = cleanProject({ name: input.name ?? '', description: input.description ?? '' })
  if ('error' in clean) return clean
  const row: ProjectRow = {
    id: nextId('pj'),
    name: clean.name!,
    description: clean.description!,
    created_by: user.id,
    created_at: new Date().toISOString(),
  }
  PROJECTS.push(row)
  return toProject(row, user)
}

export function updateProject(
  user: User,
  id: string,
  patch: Partial<ProjectInput>,
): Project | Failure {
  const row = PROJECTS.find((p) => p.id === id)
  if (!row) return notFound('프로젝트를')
  const clean = cleanProject(patch)
  if ('error' in clean) return clean
  Object.assign(row, clean)
  return toProject(row, user)
}

/** 만든 사람과 임원만. 딸린 업무도 같이 지운다. */
export function deleteProject(user: User, id: string): { ok: true } | Failure {
  const index = PROJECTS.findIndex((p) => p.id === id)
  if (index < 0) return notFound('프로젝트를')
  if (PROJECTS[index].created_by !== user.id && user.role !== 'exec') {
    return fail(403, 'FORBIDDEN', '만든 사람과 임원만 지울 수 있습니다.')
  }
  PROJECTS.splice(index, 1)
  for (let i = TASKS.length - 1; i >= 0; i--) {
    if (TASKS[i].project_id === id) TASKS.splice(i, 1)
  }
  return { ok: true }
}

export function listTasks(projectId: string): Task[] | Failure {
  if (!PROJECTS.some((p) => p.id === projectId)) return notFound('프로젝트를')
  return TASKS.filter((t) => t.project_id === projectId).map(toTask)
}

export function createTask(projectId: string, input: Partial<TaskInput>): Task | Failure {
  if (!PROJECTS.some((p) => p.id === projectId)) return notFound('프로젝트를')
  const clean = cleanTask({ ...input, title: input.title ?? '' })
  if ('error' in clean) return clean
  const row: TaskRow = {
    id: nextId('tk'),
    project_id: projectId,
    title: clean.title!,
    stage: clean.stage ?? 'todo',
    assignee_id: clean.assignee_id ?? null,
    start_date: clean.start_date ?? null,
    due_date: clean.due_date ?? null,
    priority: clean.priority ?? 'normal',
    note: clean.note ?? '',
    created_at: new Date().toISOString(),
  }
  if (reversed(row)) return reversedFailure
  TASKS.push(row)
  return toTask(row)
}

/** 시작일·마감일 중 한쪽만 고쳐도 남은 쪽과 비교한다. */
const reversed = (row: Pick<TaskRow, 'start_date' | 'due_date'>) =>
  !!row.start_date && !!row.due_date && row.start_date > row.due_date
const reversedFailure = invalid('시작일이 마감일보다 늦습니다.')

export function updateTask(id: string, patch: Partial<TaskInput>): Task | Failure {
  const row = TASKS.find((t) => t.id === id)
  if (!row) return notFound('업무를')
  const clean = cleanTask(patch)
  if ('error' in clean) return clean
  if (reversed({ ...row, ...clean })) return reversedFailure
  Object.assign(row, clean)
  return toTask(row)
}

export function deleteTask(id: string): { ok: true } | Failure {
  const index = TASKS.findIndex((t) => t.id === id)
  if (index < 0) return notFound('업무를')
  TASKS.splice(index, 1)
  return { ok: true }
}
