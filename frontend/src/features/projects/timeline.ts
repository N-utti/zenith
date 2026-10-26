import { formatISODate, formatISOYearDate } from '@/lib/datetime'
import type { Task } from './types'

const DAY = 86_400_000

/** `YYYY-MM-DD` → 1970-01-01 부터 센 날 수. UTC 로 세서 시간대에 흔들리지 않는다. */
export const dayNumber = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY
}

/** 날 수 → 그날의 `Date`. 요일·날짜는 `getUTC*` 로 읽는다. */
export const dayDate = (n: number) => new Date(n * DAY)

/** 업무 날짜. 올해가 아니면 연도를 붙인다. 업무 마감은 해를 넘는다. 보드 카드와 일정 막대가 같이 쓴다. */
export const formatTaskDate = (iso: string) =>
  iso.startsWith(`${new Date().getFullYear()}-`) ? formatISODate(iso) : formatISOYearDate(iso)

/** 오늘 마감은 아직 안 지났다. 끝낸 업무는 지나도 빨갛게 하지 않는다. 보드 카드와 일정 막대가 같이 쓴다. */
export const isOverdue = (task: Task, todayIso: string) =>
  task.stage !== 'done' && task.due_date !== null && task.due_date < todayIso

/** 막대 하나. `from`·`to` 는 표 첫날부터 센 칸 번호(둘 다 포함). 날짜가 없으면 둘 다 `null`. */
export interface TimelineRow {
  task: Task
  from: number | null
  to: number | null
}

export interface Timeline {
  /** 표 첫날의 날 수. */
  first: number
  /** 표가 덮는 날 수. */
  length: number
  /** 오늘의 칸 번호. */
  today: number
  rows: TimelineRow[]
}

/** 앞뒤로 비워 두는 날. 막대가 표 끝에 붙지 않게 한다. */
const PAD = 3
/** 업무가 몰려 있어도 표가 이만큼은 덮는다. 너무 짧으면 막대 길이로 기간을 가늠하기 어렵다. */
const MIN_LENGTH = 28

/**
 * 일정 탭(간트)의 칸 배치. 막대는 시작일부터 마감일까지다. 한쪽만 있으면 그날 하루짜리로,
 * 둘 다 없으면 막대 없이 맨 아래에 둔다. 표는 오늘과 모든 막대를 덮는다.
 *
 * ponytail: 칸은 하루 단위 하나다. 몇 달짜리 프로젝트는 가로로 길게 스크롤된다. 주·월 단위로
 * 접어 보기는 실제로 긴 프로젝트가 생기면 붙인다.
 */
export function buildTimeline(tasks: Task[], todayIso: string): Timeline {
  const today = dayNumber(todayIso)
  const spans = tasks.map((task) => {
    const start = task.start_date ?? task.due_date
    const end = task.due_date ?? task.start_date
    return { task, a: start ? dayNumber(start) : null, b: end ? dayNumber(end) : null }
  })
  const dated = spans.filter((s) => s.a !== null)
  const first = Math.min(today, ...dated.map((s) => s.a!)) - PAD
  const last = Math.max(today, ...dated.map((s) => s.b!), first + MIN_LENGTH - 1 - PAD) + PAD

  // 일찍 시작하는 것이 위. 날짜 없는 것은 아래에 등록한 순서로.
  const order = (s: (typeof spans)[number]) => s.a ?? Number.POSITIVE_INFINITY
  spans.sort(
    (x, y) =>
      order(x) - order(y) ||
      (x.b ?? 0) - (y.b ?? 0) ||
      x.task.created_at.localeCompare(y.task.created_at),
  )
  return {
    first,
    length: last - first + 1,
    today: today - first,
    rows: spans.map(({ task, a, b }) => ({
      task,
      from: a === null ? null : a - first,
      to: b === null ? null : b - first,
    })),
  }
}
