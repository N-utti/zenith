import { useRef, useState } from 'react'
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
import { useAddTask, useDeleteTask, useTodayTasks, useToggleTask } from './api'
import { TODO_TEXT_MAX } from './types'

export function TodayTasksCard() {
  const { data, isPending, isError, refetch } = useTodayTasks()
  const toggle = useToggleTask()
  const add = useAddTask()
  const remove = useDeleteTask()
  const toast = useToast()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || add.isPending) return
    // 입력창은 먼저 비운다. 실패하면 되돌려 다시 고칠 수 있게 한다.
    setText('')
    add.mutate(trimmed, {
      onError: (err) => {
        // 그 사이 다시 치고 있으면 건드리지 않는다. 덮어쓰면 치던 글자가 사라진다.
        setText((current) => current || trimmed)
        fail(err, '할 일을 추가하지 못했습니다.')
      },
    })
  }

  return (
    <HomeSection title="오늘 할 일">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && !data && <CardEmpty onRetry={refetch}>할 일을 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (data.length === 0 ? (
            <CardEmpty>오늘 할 일이 없습니다.</CardEmpty>
          ) : (
            <ul className="p-1.5">
              {data.map((task) => (
                <li
                  key={task.id}
                  className="group/task hover:bg-surface-hover flex items-start gap-2 rounded-lg px-3 py-2"
                >
                  <Checkbox
                    checked={task.done}
                    onChange={(e) => toggle.mutate({ id: task.id, done: e.target.checked })}
                    label={
                      <span className={cn('break-words', task.done && 'text-subtle line-through')}>
                        {task.text}
                      </span>
                    }
                    className="min-w-0 flex-1"
                  />
                  {/* 보이지만 않을 뿐 초점은 받는다. Tab 으로도 닿는다. */}
                  <button
                    type="button"
                    aria-label={`${task.text} 지우기`}
                    onClick={() => {
                      remove.mutate(task.id, {
                        onError: (err) => fail(err, '할 일을 지우지 못했습니다.'),
                      })
                      // 낙관적 삭제라 이 줄이 곧 사라진다. 초점이 body 로 떨어지면 키보드
                      // 사용자는 Tab 을 처음부터 다시 눌러야 한다.
                      input.current?.focus()
                    }}
                    // 숨어 있을 때는 눌리지도 않는다. 호버가 없는 기기에서 목록을 스크롤하려다
                    // 보이지 않는 버튼을 눌러 지워지는 일을 막는다. 되돌릴 수 없는 동작이다.
                    className="text-subtle hover:text-danger grid size-6 shrink-0 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-focus-within/task:pointer-events-auto group-focus-within/task:opacity-100 group-hover/task:pointer-events-auto group-hover/task:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 pointer-events-none"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ))}

        <div className="border-line flex items-center gap-2 border-t px-3 py-2">
          {/* `Input` 의 아이콘 분기는 바깥 div 가 플렉스 자식이라 폭 클래스를 여기서 준다. */}
          <div className="min-w-0 flex-1">
            <Input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={TODO_TEXT_MAX}
              aria-label="할 일 추가"
              placeholder="할 일 추가 후 Enter"
              icon={<Plus className="size-4" />}
              onKeyDown={(e) => {
                // 한글 조합 확정 Enter 는 거른다(팔레트·작성창과 같은 규약).
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          {add.isPending && <Spinner />}
        </div>
      </Card>
    </HomeSection>
  )
}
