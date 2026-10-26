import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { formatMonth, toISODate } from '@/lib/datetime'
import { buildTimeline, dayDate, formatTaskDate, isOverdue } from './timeline'
import { personName, TASK_STAGES, type Task, type TaskStage } from './types'

/**
 * 하루 칸의 최소 폭(px). 날짜 숫자와 오늘 동그라미(20px)가 들어가는 폭이다. 칸은 표의 남는 폭을
 * 똑같이 나눠 가지고, 이 폭 밑으로 줄어야 할 만큼 기간이 길 때만 가로로 스크롤된다.
 *
 * ponytail: 넓은 화면에서도 6주쯤 넘는 기간은 스크롤된다. 그보다 긴 프로젝트가 흔해지면 주 단위로 접는다.
 */
const MIN_DAY_W = 20

const STAGE_BAR: Record<TaskStage, string> = {
  todo: 'bg-line-strong',
  doing: 'bg-accent',
  review: 'bg-warning',
  done: 'bg-success',
}

const LABEL_COL = 'w-32 sm:w-56'

/**
 * 프로젝트 업무의 일정 표(간트). 왼쪽에 업무 제목, 오른쪽에 하루 한 칸짜리 날짜 줄과 막대.
 * 가로로 넘치면 표만 스크롤되고 제목 열은 붙어 있다. 막대를 끌어 날짜를 바꾸지는 않는다.
 * 제목이나 막대를 누르면 보드와 같은 업무 창이 열려 거기서 고친다.
 */
export function ProjectTimeline({
  tasks,
  onOpen,
}: {
  tasks: Task[]
  onOpen: (task: Task) => void
}) {
  const todayIso = toISODate(new Date())
  const timeline = buildTimeline(tasks, todayIso)
  const days = Array.from({ length: timeline.length }, (_, i) => dayDate(timeline.first + i))
  const scroller = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  // 처음 열 때 오늘이 날짜 쪽 폭의 3분의 1쯤에 오게 한다. 지난 업무도 조금 보이고 앞으로의 일정이
  // 더 넓게 보인다. 업무를 고쳐 표가 다시 그려질 때는 그대로 둔다.
  useLayoutEffect(() => {
    const el = scroller.current
    if (scrolled.current || !el) return
    scrolled.current = true
    const visible = el.clientWidth - (labels.current?.offsetWidth ?? 0)
    // 스크롤이 생기는 건 칸이 최소 폭에 걸렸을 때뿐이라, 그때 하루 칸은 MIN_DAY_W 다.
    el.scrollLeft = Math.max(0, timeline.today * MIN_DAY_W - visible / 3)
  }, [timeline.today])

  /** 표 첫날부터 `day` 칸만큼의 위치를 날짜 쪽 폭에 대한 비율로. 칸 폭이 정해져 있지 않아 px 로 못 놓는다. */
  const at = (day: number) => `${(day / timeline.length) * 100}%`

  return (
    <div className="space-y-2">
      <ul className="text-muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {TASK_STAGES.map((stage) => (
          <li key={stage.key} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-3 rounded-sm', STAGE_BAR[stage.key])} />
            {stage.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="bg-danger h-2 w-3 rounded-sm" />
          기한 지남
        </li>
      </ul>
      {/* 키보드로 초점을 줘야 방향키로 가로 스크롤된다. 안의 제목 버튼은 붙은 열이라 초점이 가도 밀리지 않는다. */}
      <div
        ref={scroller}
        role="region"
        aria-label="업무 일정"
        tabIndex={0}
        className="border-line bg-surface overflow-x-auto rounded-xl border"
      >
        <div className="flex w-max min-w-full">
          <div
            ref={labels}
            className={cn('bg-surface border-line sticky left-0 z-10 shrink-0 border-r', LABEL_COL)}
          >
            <div className="border-line text-subtle flex h-12 items-end border-b px-3 pb-1.5 text-xs">
              업무
            </div>
            {timeline.rows.map(({ task }) => (
              <div key={task.id} className="flex h-9 items-center px-3">
                <button
                  type="button"
                  data-task-open={task.id}
                  onClick={() => onOpen(task)}
                  className={cn(
                    'hover:text-accent w-full cursor-pointer truncate text-left text-sm hover:underline',
                    task.stage === 'done' ? 'text-subtle line-through' : 'text-fg',
                  )}
                >
                  {task.title}
                  {/* 날짜는 막대로만 보이고 막대는 읽히지 않으니, 화면 읽기 프로그램에는 여기서 읽어 준다. */}
                  <span className="sr-only">, {dateRange(task) ?? '날짜 없음'}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="relative flex-1" style={{ minWidth: timeline.length * MIN_DAY_W }}>
            <div className="border-line h-12 border-b">
              <div className="flex h-6">
                {monthSpans(days).map(({ key, label, length }) => (
                  <div
                    key={key}
                    className="min-w-0 overflow-clip"
                    // 날 수만큼 늘어난다. 바탕 폭이 0 이라 달마다 정확히 하루 칸의 배수가 된다.
                    style={{ flex: `${length} 0 0%` }}
                  >
                    {/* 달 이름은 스크롤해도 제목 열 바로 옆에 붙어 있다. 그 달 칸이 다 지나가면 같이 밀려난다.
                        붙는 자리는 제목 열 폭(LABEL_COL)과 같아야 한다. 하루이틀뿐인 달은 이름이 잘린다.
                        overflow-hidden 은 스크롤 상자가 돼 sticky 가 풀리므로 clip 이다. */}
                    <span className="text-muted sticky left-32 inline-block px-1.5 pt-1.5 text-xs font-medium whitespace-nowrap sm:left-56">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex h-6">
                {days.map((d, i) => (
                  <span key={i} className="grid min-w-0 flex-1 place-items-center text-[11px]">
                    <span
                      className={cn(
                        'grid size-5 place-items-center rounded-full',
                        i === timeline.today
                          ? 'bg-accent text-on-accent font-semibold'
                          : isWeekend(d)
                            ? 'text-subtle'
                            : 'text-muted',
                      )}
                    >
                      {d.getUTCDate()}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              {/* 주말 칸과 오늘 선. 줄마다 그리지 않고 표 전체에 한 겹 깐다. */}
              <div aria-hidden className="pointer-events-none absolute inset-0">
                {days.map((d, i) =>
                  isWeekend(d) ? (
                    <div
                      key={i}
                      className="bg-sunken absolute inset-y-0"
                      style={{ left: at(i), width: at(1) }}
                    />
                  ) : null,
                )}
                <div
                  className="bg-accent absolute inset-y-0 w-px"
                  style={{ left: at(timeline.today + 0.5) }}
                />
              </div>
              {timeline.rows.map(({ task, from, to }) => (
                <div key={task.id} className="relative h-9">
                  {from !== null && to !== null && (
                    // 키보드는 왼쪽 제목 버튼으로 연다. 막대까지 탭 순서에 넣으면 업무마다 두 번 멈춘다.
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      title={barTitle(task)}
                      onClick={() => onOpen(task)}
                      className={cn(
                        'absolute top-2 h-5 cursor-pointer rounded-md hover:opacity-80',
                        isOverdue(task, todayIso) ? 'bg-danger' : STAGE_BAR[task.stage],
                      )}
                      style={{
                        left: `calc(${at(from)} + 2px)`,
                        width: `calc(${at(to - from + 1)} - 4px)`,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6

/** 연속한 날을 달마다 묶는다. 올해가 아닌 달은 연도를 붙인다. */
function monthSpans(days: Date[]) {
  const spans: { key: string; label: string; length: number }[] = []
  for (const d of days) {
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const key = `${year}-${month}`
    const last = spans.at(-1)
    if (last?.key === key) last.length++
    else {
      const label =
        year === new Date().getFullYear()
          ? `${month}월`
          : formatMonth(`${year}-${String(month).padStart(2, '0')}`)
      spans.push({ key, label, length: 1 })
    }
  }
  return spans
}

/** `시작 ~ 마감`. 한쪽만 있거나 같은 날이면 그날 하나, 둘 다 없으면 `null`. */
function dateRange(task: Task) {
  const start = task.start_date ?? task.due_date
  const end = task.due_date ?? task.start_date
  if (!start || !end) return null
  return start === end ? formatTaskDate(start) : `${formatTaskDate(start)} ~ ${formatTaskDate(end)}`
}

function barTitle(task: Task) {
  return [task.title, task.assignee ? personName(task.assignee) : null, dateRange(task)]
    .filter(Boolean)
    .join(', ')
}
