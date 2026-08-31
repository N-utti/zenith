import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { HomeSection } from './HomeSection'
import { useTodayTasks, useToggleTask } from './api'

export function TodayTasksCard() {
  const { data, isPending, isError } = useTodayTasks()
  const toggle = useToggleTask()

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
                <li key={task.id}>
                  <button
                    type="button"
                    aria-pressed={task.done}
                    onClick={() => toggle.mutate({ id: task.id, done: !task.done })}
                    className="hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors"
                  >
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                        task.done
                          ? 'bg-accent border-accent text-on-accent'
                          : 'border-line-strong',
                      )}
                    >
                      {task.done && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[13px]',
                        task.done ? 'text-subtle line-through' : 'text-fg',
                      )}
                    >
                      {task.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
