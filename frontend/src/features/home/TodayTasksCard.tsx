import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { HomeSection } from './HomeSection'
import { TODO_TEXT_MAX, useAddTask, useDeleteTask, useTodayTasks, useToggleTask } from './api'

export function TodayTasksCard() {
  const { data, isPending, isError } = useTodayTasks()
  const toggle = useToggleTask()
  const add = useAddTask()
  const remove = useDeleteTask()
  const toast = useToast()
  const [text, setText] = useState('')

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || add.isPending) return
    // 입력창은 먼저 비운다. 실패하면 되돌려 다시 고칠 수 있게 한다.
    setText('')
    add.mutate(trimmed, {
      onError: (err) => {
        setText(trimmed)
        fail(err, '할 일을 추가하지 못했습니다.')
      },
    })
  }

  return (
    <HomeSection title="오늘 할 일">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && <CardEmpty>할 일을 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (data.items.length === 0 ? (
            <CardEmpty>오늘 할 일이 없습니다.</CardEmpty>
          ) : (
            <ul className="p-1.5">
              {data.items.map((task) => (
                <li
                  key={task.id}
                  className="group/task hover:bg-surface-hover flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  <Checkbox
                    checked={task.done}
                    onChange={(e) => toggle.mutate({ id: task.id, done: e.target.checked })}
                    label={
                      <span className={cn(task.done && 'text-subtle line-through')}>
                        {task.text}
                      </span>
                    }
                    className="min-w-0 flex-1"
                  />
                  {/* 보이지만 않을 뿐 초점은 받는다. Tab 으로도 닿는다. */}
                  <button
                    type="button"
                    aria-label={`${task.text} 지우기`}
                    onClick={() =>
                      remove.mutate(task.id, {
                        onError: (err) => fail(err, '할 일을 지우지 못했습니다.'),
                      })
                    }
                    className="text-subtle hover:text-danger grid size-6 shrink-0 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-focus-within/task:opacity-100 group-hover/task:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ))}

        <form onSubmit={submit} className="border-line flex items-center gap-2 border-t px-3 py-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={TODO_TEXT_MAX}
            aria-label="할 일 추가"
            placeholder="할 일 추가"
            icon={<Plus className="size-4" />}
            className="flex-1"
          />
          {add.isPending && <Spinner />}
        </form>
      </Card>
    </HomeSection>
  )
}
