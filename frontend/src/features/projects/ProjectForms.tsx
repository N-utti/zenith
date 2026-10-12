import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { FormModal } from '@/features/crm/CrmForms'
import { useColleagues } from '@/features/people/colleagues'
import { ApiError } from '@/lib/api'
import {
  useCreateProject,
  useCreateTask,
  useDeleteTask,
  useUpdateProject,
  useUpdateTask,
} from './api'
import {
  personName,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  TASK_NOTE_MAX,
  TASK_PRIORITIES,
  TASK_STAGES,
  TASK_TITLE_MAX,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStage,
} from './types'

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

const STAGE_OPTIONS = TASK_STAGES.map((s) => ({ value: s.key, label: s.label }))
const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({ value: p.key, label: p.label }))

/** 프로젝트를 만들거나(`project` 없음) 이름·설명을 고친다. 만들면 그 보드로 간다. */
export function ProjectFormModal({ project, onClose }: { project?: Project; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateProject()
  const update = useUpdateProject()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    const fields = { name: name.trim(), description: description.trim() }
    const onError = (err: unknown) => setError(errorText(err, '저장하지 못했습니다.'))
    if (project) {
      update.mutate(
        { id: project.id, ...fields },
        {
          onSuccess: () => {
            toast.success('저장했습니다.')
            onClose()
          },
          onError,
        },
      )
      return
    }
    create.mutate(fields, {
      onSuccess: (made) => {
        toast.success('프로젝트를 만들었습니다.')
        onClose()
        void navigate(`/projects/${made.id}`)
      },
      onError,
    })
  }

  return (
    <FormModal
      title={project ? '프로젝트 수정' : '새 프로젝트'}
      busy={create.isPending || update.isPending}
      error={error}
      submitLabel={project ? '저장' : '만들기'}
      canSubmit={name.trim().length > 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="이름" required>
        {(slot) => (
          <Input
            {...slot}
            value={name}
            maxLength={PROJECT_NAME_MAX}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="설명">
        {(slot) => (
          <Textarea
            {...slot}
            rows={3}
            value={description}
            maxLength={PROJECT_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
    </FormModal>
  )
}

/**
 * 업무를 등록하거나(`task` 없음) 고친다. 단계 선택이 늘 있어, 카드를 끌지 못하는 손가락 기기와
 * 키보드 사용자는 여기서 단계를 옮긴다(WCAG 2.5.7 의 끌기 대안).
 */
export function TaskFormModal({
  projectId,
  task,
  stage: presetStage = 'todo',
  onClose,
}: {
  projectId: string
  task?: Task
  stage?: TaskStage
  onClose: () => void
}) {
  const toast = useToast()
  const me = useCurrentUser()
  const { people } = useColleagues()
  const staff = [{ id: me.id, name: me.name }, ...people]
  const create = useCreateTask(projectId)
  const update = useUpdateTask(projectId)
  const remove = useDeleteTask()
  const [title, setTitle] = useState(task?.title ?? '')
  const [stage, setStage] = useState<TaskStage>(task?.stage ?? presetStage)
  const [assignee, setAssignee] = useState(task?.assignee?.id ?? '')
  const [due, setDue] = useState(task?.due_date ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal')
  const [note, setNote] = useState(task?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const assigneeOptions = [
    { value: '', label: '지정 안 함' },
    ...staff.map((p) => ({ value: p.id, label: p.name })),
    // 퇴사한 기존 담당자도 목록에 남겨야 그대로 저장된다.
    ...(task?.assignee && !staff.some((p) => p.id === task.assignee?.id)
      ? [{ value: task.assignee.id, label: personName(task.assignee) }]
      : []),
  ]

  const done = (message: string) => () => {
    toast.success(message)
    onClose()
  }
  const onError = (err: unknown) => setError(errorText(err, '저장하지 못했습니다.'))

  const submit = () => {
    setError(null)
    const fields = {
      title: title.trim(),
      stage,
      assignee_id: assignee || null,
      due_date: due || null,
      priority,
      note: note.trim(),
    }
    if (!task) {
      create.mutate(fields, { onSuccess: done('업무를 등록했습니다.'), onError })
      return
    }
    // 바뀐 칸만 보낸다. 전부 보내면 담당자가 그사이 비활성 계정이 된 업무는 제목만 고쳐도
    // 서버가 담당자를 다시 검사해 거절한다.
    const original: typeof fields = {
      title: task.title,
      stage: task.stage,
      assignee_id: task.assignee?.id ?? null,
      due_date: task.due_date,
      priority: task.priority,
      note: task.note,
    }
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => v !== original[k as keyof typeof fields]),
    ) as Partial<typeof fields>
    if (Object.keys(changed).length === 0) return onClose()
    update.mutate({ id: task.id, ...changed }, { onSuccess: done('저장했습니다.'), onError })
  }

  return (
    <FormModal
      title={task ? '업무 수정' : '업무 등록'}
      busy={create.isPending || update.isPending || remove.isPending}
      error={error}
      submitLabel={task ? '저장' : '등록'}
      canSubmit={title.trim().length > 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="제목" required>
        {(slot) => (
          <Input
            {...slot}
            value={title}
            maxLength={TASK_TITLE_MAX}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="단계">
          {(slot) => (
            <Select
              {...slot}
              value={stage}
              options={STAGE_OPTIONS}
              onChange={(e) => setStage(e.target.value as TaskStage)}
            />
          )}
        </Field>
        <Field label="담당자">
          {(slot) => (
            <Select
              {...slot}
              value={assignee}
              options={assigneeOptions}
              onChange={(e) => setAssignee(e.target.value)}
            />
          )}
        </Field>
        <Field label="마감일">
          {(slot) => (
            <Input {...slot} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          )}
        </Field>
        <Field label="중요도">
          {(slot) => (
            <Select
              {...slot}
              value={priority}
              options={PRIORITY_OPTIONS}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            />
          )}
        </Field>
      </div>
      <Field label="메모">
        {(slot) => (
          <Textarea
            {...slot}
            rows={4}
            value={note}
            maxLength={TASK_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      {task && (
        <Button
          // 폼 안이라 종류를 안 적으면 제출 버튼이 된다.
          type="button"
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={() => {
            if (!confirm(`"${task.title}" 업무를 지웁니다. 되돌릴 수 없습니다.`)) return
            remove.mutate(task.id, {
              onSuccess: done('업무를 지웠습니다.'),
              onError: (err) => setError(errorText(err, '지우지 못했습니다.')),
            })
          }}
        >
          업무 지우기
        </Button>
      )}
    </FormModal>
  )
}
