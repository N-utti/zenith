import { MSW_ENABLED } from '@/mocks/accounts'
import type { Schema } from '@/types'

/** 협업 공간(프로젝트 칸반보드)의 타입. 모양은 서버 계약에서 끌어오고, 화면 라벨과 길이 상한만 여기 둔다. */

export type Person = Schema<'app__routers__projects__Person'>

/** 지운 계정은 서버가 이름을 빈 문자열로 준다. */
export const personName = (person: Person) => person.name || '알 수 없음'

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

/** `can_delete` 는 만든 사람과 임원에게만 참이다. 판정은 서버가 한다. */
export type Project = Schema<'ProjectOut'>

/**
 * `start_date`·`due_date` 는 `YYYY-MM-DD`.
 *
 * `start_date` 는 **계약에 아직 없다.** 일정 탭(간트)의 막대 시작점이라 목만 먼저 준다. 서버가
 * 안 주는 동안 막대는 마감일 하루짜리로 그려진다(`timeline.ts`).
 */
export type Task = Schema<'TaskOut'> & { start_date?: string | null }

/**
 * 업무 창의 시작일 칸은 목에서만 보인다. 실서버는 모르는 칸을 버리고 200 을 줘서, 칸을 보이면
 * 저장했다는 토스트 뒤에 시작일이 사라진다. 서버에 칸이 생기면 이 스위치를 걷는다.
 */
export const START_DATE_ENABLED = MSW_ENABLED

// 서버는 이름·제목 말고는 기본값을 채워 주지만, 화면은 늘 전부 보낸다.
export type ProjectInput = Required<Schema<'ProjectIn'>>
export type TaskInput = Required<Schema<'TaskIn'>> & { start_date: string | null }
