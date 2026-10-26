import { useState, type DragEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Plus } from 'lucide-react'
import { BackLink } from '@/components/ui/BackLink'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { useDeleteProject, useProject, useTasks, useUpdateTask } from '@/features/projects/api'
import { ProjectFormModal, TaskFormModal } from '@/features/projects/ProjectForms'
import { ProjectProgress } from '@/features/projects/ProjectProgress'
import { ProjectTimeline } from '@/features/projects/ProjectTimeline'
import { formatTaskDate, isOverdue } from '@/features/projects/timeline'
import { personName, TASK_STAGES, type Task, type TaskStage } from '@/features/projects/types'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { toISODate } from '@/lib/datetime'

/** 끌어 옮기는 카드의 id 를 싣는 형식. 다른 곳에서 끌어 온 글자·파일은 무시한다. */
const DRAG_TYPE = 'application/x-zenith-task'

/**
 * 마우스가 있는 기기에서만 끌기를 켠다(CRM 안건 보드와 같은 규칙). 아이폰 사파리는 `draggable`
 * 요소를 길게 누르면 끌기를 시작해 세로 스크롤과 부딪힌다. 손가락 기기와 키보드는 카드를 열어
 * 그 안의 단계 선택으로 옮긴다. 카드마다 단계 선택을 두지 않는다. 폰에서 카드마다 상자가 하나씩
 * 더 붙어 보드가 상자투성이가 된다.
 */
const CAN_DRAG =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches

/** 마감이 이른 것이 위, 마감 없는 것은 아래. `YYYY-MM-DD` 는 문자열 순서가 곧 날짜 순서다. */
const byDue = (a: Task, b: Task) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
  a.created_at.localeCompare(b.created_at)

/**
 * 단계가 바뀐 카드는 다른 열에 새로 그려져 초점이 사라진다. 옮긴 카드로 초점을 되돌리고,
 * 지워서 없으면 그대로 둔다. 다시 그린 뒤에 찾도록 한 박자 미룬다(CRM 보드의 `refocus`).
 */
function refocus(selector: string) {
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(selector)
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  })
}

const VIEWS = [
  { key: 'board', label: '보드' },
  { key: 'timeline', label: '일정' },
]

type Dialog = { kind: 'project' } | { kind: 'new'; stage: TaskStage } | { kind: 'task'; task: Task }

/** 프로젝트 하나의 칸반보드. 단계 열에 업무 카드를 두고 끌어서 단계를 옮긴다. */
export function ProjectBoardPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const project = useProject(projectId)
  const remove = useDeleteProject()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  // 보기는 주소에 둔다. 새로고침해도 뒤로 가기를 해도 그 자리다(관리자 탭과 같은 규약).
  const [params, setParams] = useSearchParams()

  if (project.isPending) return <SkeletonRows rows={4} />
  if (!project.data) {
    return (
      <>
        <BackLink to="/projects">협업 공간</BackLink>
        <p className="text-danger py-8 text-center text-sm">
          {project.error instanceof ApiError && project.error.status === 404
            ? '없거나 삭제된 프로젝트입니다.'
            : '프로젝트를 불러오지 못했습니다.'}
        </p>
      </>
    )
  }
  const data = project.data

  const onDelete = () => {
    if (
      !confirm(
        `"${data.name}" 프로젝트와 업무 ${data.task_count}개를 지웁니다. 되돌릴 수 없습니다.`,
      )
    )
      return
    remove.mutate(data.id, {
      onSuccess: () => {
        toast.success('프로젝트를 지웠습니다.')
        void navigate('/projects')
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : '지우지 못했습니다.'),
    })
  }

  return (
    <>
      <BackLink to="/projects">협업 공간</BackLink>
      <PageHeader
        title={data.name}
        description={data.description || undefined}
        actions={
          <>
            {data.can_delete && (
              <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={onDelete}>
                지우기
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'project' })}>
              수정
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'new', stage: 'todo' })}>
              <Plus className="size-4" />
              업무 등록
            </Button>
          </>
        }
      />
      <div className="mb-4 max-w-sm">
        <ProjectProgress project={data} />
      </div>
      <Tabs
        items={VIEWS}
        value={params.get('view') ?? 'board'}
        // 다른 파라미터는 남기고 `view` 만 바꾼다.
        onChange={(view) =>
          setParams(
            (prev) => {
              if (view === 'board') prev.delete('view')
              else prev.set('view', view)
              return prev
            },
            { replace: true },
          )
        }
      >
        {(view) =>
          view === 'timeline' ? (
            <Timeline projectId={data.id} onOpen={(task) => setDialog({ kind: 'task', task })} />
          ) : (
            <Board
              projectId={data.id}
              onOpen={(task) => setDialog({ kind: 'task', task })}
              onAdd={(stage) => setDialog({ kind: 'new', stage })}
            />
          )
        }
      </Tabs>
      {dialog?.kind === 'project' && (
        <ProjectFormModal project={data} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'new' && (
        <TaskFormModal projectId={data.id} stage={dialog.stage} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'task' && (
        <TaskFormModal
          projectId={data.id}
          task={dialog.task}
          onClose={() => {
            setDialog(null)
            refocus(`[data-task-open="${dialog.task.id}"]`)
          }}
        />
      )}
    </>
  )
}

function Board({
  projectId,
  onOpen,
  onAdd,
}: {
  projectId: string
  onOpen: (task: Task) => void
  onAdd: (stage: TaskStage) => void
}) {
  const toast = useToast()
  const tasks = useTasks(projectId)
  const move = useUpdateTask(projectId, (err) =>
    toast.error(err instanceof ApiError ? err.message : '단계를 옮기지 못했습니다.'),
  )
  /** 끌고 있는 카드 위에 떠 있는 열. 떨어뜨릴 자리를 칠해 보인다. */
  const [over, setOver] = useState<TaskStage | null>(null)
  const items = tasks.data?.items ?? []

  const moveTo = (task: Task, stage: TaskStage) => {
    if (stage === task.stage) return
    move.mutate({ id: task.id, stage })
  }

  const onDrop = (event: DragEvent, stage: TaskStage) => {
    event.preventDefault()
    setOver(null)
    const task = items.find((t) => t.id === event.dataTransfer.getData(DRAG_TYPE))
    if (task) moveTo(task, stage)
  }

  if (tasks.isPending) return <SkeletonRows rows={4} />
  if (!tasks.data) {
    return <p className="text-danger py-8 text-center text-sm">업무를 불러오지 못했습니다.</p>
  }

  return (
    // 좁으면 단계마다 세로로 쌓고 넓으면 열을 가로로 놓는다. 기준은 화면이 아니라 이 보드의
    // 폭이다(@container). 사이드바가 폭을 먹어서 화면 폭으로 가르면 열이 눌린다(CRM 보드와 같다).
    <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-4">
        {TASK_STAGES.map((stage) => {
          const inStage = items.filter((t) => t.stage === stage.key).sort(byDue)
          return (
            <section
              key={stage.key}
              aria-label={`${stage.label} 단계`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setOver(stage.key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(e) => onDrop(e, stage.key)}
              className={cn(
                'bg-sunken min-h-24 rounded-xl p-2 transition-colors',
                over === stage.key && 'bg-accent-soft',
              )}
            >
              <header className="flex items-center justify-between px-1.5 pt-1 pb-2">
                <h2 className="text-fg text-sm font-semibold">
                  {stage.label}
                  <span className="text-subtle ml-1.5 font-normal">{inStage.length}</span>
                </h2>
                <button
                  type="button"
                  aria-label={`${stage.label}에 업무 등록`}
                  title="업무 등록"
                  onClick={() => onAdd(stage.key)}
                  className="text-subtle hover:text-fg grid size-6 cursor-pointer place-items-center rounded"
                >
                  <Plus className="size-4" />
                </button>
              </header>
              <ul className="space-y-2">
                {inStage.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Timeline({ projectId, onOpen }: { projectId: string; onOpen: (task: Task) => void }) {
  const tasks = useTasks(projectId)
  if (tasks.isPending) return <SkeletonRows rows={4} />
  if (!tasks.data) {
    return <p className="text-danger py-8 text-center text-sm">업무를 불러오지 못했습니다.</p>
  }
  return <ProjectTimeline tasks={tasks.data.items} onOpen={onOpen} />
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const done = task.stage === 'done'
  const overdue = isOverdue(task, toISODate(new Date()))
  return (
    <li
      draggable={CAN_DRAG}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={cn(
        'border-line bg-surface space-y-1.5 rounded-lg border p-3',
        CAN_DRAG && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <button
        type="button"
        data-task-open={task.id}
        onClick={() => onOpen(task)}
        className={cn(
          'hover:text-accent block w-full cursor-pointer text-left text-sm font-medium break-words hover:underline',
          done ? 'text-subtle line-through' : 'text-fg',
        )}
      >
        {task.title}
      </button>
      <p className="text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {task.priority === 'high' && <Badge tone="danger">높음</Badge>}
        {task.priority === 'low' && <Badge tone="subtle">낮음</Badge>}
        {task.assignee ? (
          personName(task.assignee)
        ) : (
          <span className="text-subtle">담당자 없음</span>
        )}
        {task.due_date && (
          <span
            className={cn('whitespace-nowrap', overdue ? 'text-danger font-medium' : 'text-subtle')}
          >
            {overdue ? '기한 지남 ' : ''}
            {formatTaskDate(task.due_date)}
          </span>
        )}
      </p>
    </li>
  )
}
