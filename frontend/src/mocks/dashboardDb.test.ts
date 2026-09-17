import { expect, it } from 'vitest'
import { addTask, findTask, listTasks, removeTask } from './dashboardDb'

// 모듈 전역 배열을 공유하고 리셋이 없다. 케이스를 더할 때는 각자 새로 만든 할 일로 한다.

it('만든 순으로 준다. 완료 여부는 정렬에 안 들어간다', () => {
  const first = addTask('먼저 만든 것')
  const second = addTask('나중에 만든 것')

  const order = () => listTasks().map((t) => t.id)
  expect(order().indexOf(first.id)).toBeLessThan(order().indexOf(second.id))

  // 백엔드 `_todos` 는 `order_by(created_at, id)` 뿐이다. 체크해도 줄이 아래로 튀면 안 된다.
  first.done = true
  expect(order().indexOf(first.id)).toBeLessThan(order().indexOf(second.id))

  removeTask(first.id)
  removeTask(second.id)
})

it('추가한 것을 찾고 지울 수 있다. 없는 것을 지우면 거짓', () => {
  const task = addTask('지울 것')
  expect(task).toMatchObject({ text: '지울 것', done: false })
  expect(findTask(task.id)).toBe(task)

  expect(removeTask(task.id)).toBe(true)
  expect(findTask(task.id)).toBeUndefined()
  expect(removeTask(task.id)).toBe(false)
})
