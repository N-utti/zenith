import { describe, expect, it } from 'vitest'
import { findAccount, patchAccount } from './adminDb'
import { MOCK_USERS } from './db'
import {
  createProject,
  createTask,
  deleteProject,
  getProject,
  listTasks,
  updateTask,
} from './projectsDb'

const staff = MOCK_USERS.find((u) => u.id === 'u-4')!
const other = MOCK_USERS.find((u) => u.id === 'u-5')!
const exec = MOCK_USERS.find((u) => u.id === 'u-11')!

/** 실패(`{error}`)면 던지고, 성공 쪽 타입으로 좁혀 돌려준다. */
const ok = <R extends object>(result: R): Exclude<R, { error: string }> => {
  if ('error' in result) throw new Error(String(result.error))
  return result as Exclude<R, { error: string }>
}

describe('projectsDb', () => {
  it('단계를 완료로 옮기면 프로젝트의 완료 수가 따라 오른다', () => {
    const project = ok(createProject(staff, { name: '  테스트  ', description: '' }))
    expect(project.name).toBe('테스트')
    const task = ok(createTask(project.id, { title: '할 것' }))
    expect(task.stage).toBe('todo')
    expect(ok(getProject(staff, project.id))).toMatchObject({ task_count: 1, done_count: 0 })

    ok(updateTask(task.id, { stage: 'done' }))
    expect(ok(getProject(staff, project.id))).toMatchObject({ task_count: 1, done_count: 1 })
  })

  it('빈 제목·없는 단계·틀린 날짜·없는 담당자는 422 다', () => {
    const project = ok(createProject(staff, { name: '검증', description: '' }))
    expect(createTask(project.id, { title: '   ' })).toMatchObject({ status: 422 })
    const task = ok(createTask(project.id, { title: '업무' }))
    expect(updateTask(task.id, { stage: 'nope' as never })).toMatchObject({ status: 422 })
    expect(updateTask(task.id, { due_date: '2026-13-40' })).toMatchObject({ status: 422 })
    expect(updateTask(task.id, { assignee_id: 'u-없음' })).toMatchObject({ status: 422 })
    // 담당자·마감은 null 로 비울 수 있다.
    ok(updateTask(task.id, { assignee_id: other.id, due_date: '2026-10-31' }))
    expect(ok(updateTask(task.id, { assignee_id: null, due_date: null }))).toMatchObject({
      assignee: null,
      due_date: null,
    })
  })

  it('담당자가 비활성이 돼도 담당자를 안 건드리는 수정은 된다', () => {
    const project = ok(createProject(staff, { name: '비활성', description: '' }))
    const task = ok(createTask(project.id, { title: '업무', assignee_id: other.id }))
    const account = findAccount(other.id)!
    patchAccount(account, { active: false })
    try {
      expect(ok(updateTask(task.id, { title: '고친 제목', stage: 'doing' })).assignee?.id).toBe(
        other.id,
      )
      expect(updateTask(task.id, { assignee_id: other.id })).toMatchObject({ status: 422 })
    } finally {
      patchAccount(account, { active: true })
    }
  })

  it('프로젝트는 만든 사람과 임원만 지우고, 딸린 업무도 같이 사라진다', () => {
    const project = ok(createProject(staff, { name: '지울 것', description: '' }))
    ok(createTask(project.id, { title: '딸린 업무' }))
    expect(ok(getProject(other, project.id)).can_delete).toBe(false)
    expect(deleteProject(other, project.id)).toMatchObject({ status: 403 })
    expect(ok(getProject(exec, project.id)).can_delete).toBe(true)

    ok(deleteProject(exec, project.id))
    expect(getProject(staff, project.id)).toMatchObject({ status: 404 })
    expect(listTasks(project.id)).toMatchObject({ status: 404 })
  })
})
