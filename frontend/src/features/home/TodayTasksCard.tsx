import { cn } from '@/lib/cn'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
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
                <li key={task.id} className="hover:bg-surface-hover rounded-lg px-3 py-2">
                  <Checkbox
                    checked={task.done}
                    onChange={(e) => toggle.mutate({ id: task.id, done: e.target.checked })}
                    label={
                      <span className={cn(task.done && 'text-subtle line-through')}>
                        {task.title}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
