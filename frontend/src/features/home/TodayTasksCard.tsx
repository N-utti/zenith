import { useRef, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { HomeSection } from './HomeSection'
import { useAddTask, useDeleteTask, useEditTask, useTodayTasks, useToggleTask } from './api'
import { TODO_TEXT_MAX } from './types'

/*
 * 줄 오른쪽의 작은 버튼(고치기·지우기). 줄에 올리거나 Tab 으로 닿을 때만 보이고, 호버가 없는
 * 기기에서는 늘 보인다. 숨어 있을 때는 눌리지도 않는다.
 */
const ROW_ACTION =
  'text-subtle grid size-6 shrink-0 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-focus-within/task:pointer-events-auto group-focus-within/task:opacity-100 group-hover/task:pointer-events-auto group-hover/task:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 pointer-events-none'

export function TodayTasksCard() {
  const { data, isPending, isError, refetch } = useTodayTasks()
  const toggle = useToggleTask()
  const add = useAddTask()
  const remove = useDeleteTask()
  const edit = useEditTask()
  const toast = useToast()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  /** 글자를 고치는 중인 줄. 한 번에 하나만 연다. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  /*
   * 고치는 칸이 아직 열려 있는가. Enter·Esc 로 닫으면 칸이 사라지면서 초점 잃음이 한 번 더
   * 올 수 있는데, 그 처리기는 닫기 전 값을 쥐고 있다. 이게 없으면 Esc 가 저장이 되거나
   * Enter 가 두 번 저장한다.
   */
  const editOpen = useRef(false)

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  const closeEdit = () => {
    editOpen.current = false
    setEditing(null)
  }

  /** 고치던 글자를 저장한다. 비었거나 그대로면 조용히 닫는다(지우기는 옆 버튼이 한다). */
  const commitEdit = (original: string) => {
    if (!editing || !editOpen.current) return
    const trimmed = editing.text.trim()
    closeEdit()
    if (!trimmed || trimmed === original) return
    edit.mutate(
      { id: editing.id, text: trimmed },
      { onError: (err) => fail(err, '할 일을 고치지 못했습니다.') },
    )
  }

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
                  {editing?.id === task.id ? (
                    <Input
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: task.id, text: e.target.value })}
                      maxLength={TODO_TEXT_MAX}
                      aria-label="할 일 고치기"
                      // -my-1.5: 줄 높이를 그대로 둔다. 칸이 닫힐 때 아래 줄이 밀리면 그 줄의 버튼을 누르던
                      // 클릭이 빗나간다.
                      className="-my-1.5 h-8 min-w-0 flex-1"
                      // 다른 곳을 누르면 저장한다. 고친 글자를 잃는 쪽보다 낫다. 그만두려면 Esc.
                      onBlur={() => commitEdit(task.text)}
                      onKeyDown={(e) => {
                        const enter = e.key === 'Enter' && !e.nativeEvent.isComposing
                        if (!enter && e.key !== 'Escape') return
                        e.preventDefault()
                        if (enter) commitEdit(task.text)
                        else closeEdit()
                        // 칸이 사라지면 초점이 body 로 떨어진다(지우기와 같은 이유).
                        input.current?.focus()
                      }}
                    />
                  ) : (
                    <Checkbox
                      checked={task.done}
                      onChange={(e) => toggle.mutate({ id: task.id, done: e.target.checked })}
                      label={
                        <span
                          className={cn('break-words', task.done && 'text-subtle line-through')}
                        >
                          {task.text}
                        </span>
                      }
                      className="min-w-0 flex-1"
                    />
                  )}
                  {editing?.id !== task.id && (
                    <button
                      type="button"
                      aria-label={`${task.text} 고치기`}
                      title="고치기"
                      onClick={() => {
                        editOpen.current = true
                        setEditing({ id: task.id, text: task.text })
                      }}
                      className={cn(ROW_ACTION, 'hover:text-fg')}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
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
                    className={cn(ROW_ACTION, 'hover:text-danger')}
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
