import { useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Calendar, CalendarDayNumber } from '@/components/ui/Calendar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { cn } from '@/lib/cn'
import { ApiError } from '@/lib/api'
import { currentMonth, formatISODate } from '@/lib/datetime'
import { useCreateEvent, useDeleteEvent } from './api'
import type { CalendarGroup, CalendarItem } from './calendarItems'
import { HomeSection } from './HomeSection'
import { DOT, MAX_CHIPS, TONE, WEEK_STARTS_ON, useCalendarItems } from './useCalendarItems'

/** 홈 캘린더. 날짜를 누르면 그날 항목과 일정 추가. 폰에서는 홈에 두지 않고 `/calendar` 탭이 맡는다. */
export function CalendarCard() {
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState<string | null>(null)
  const { days, show, toggle, isError, isPending, retry } = useCalendarItems(month)

  return (
    <HomeSection title="캘린더" to="/attendance" linkLabel="근태">
      <Card className="p-4">
        {isError && <CardEmpty onRetry={retry}>일정을 불러오지 못했습니다.</CardEmpty>}
        <Calendar
          month={month}
          onMonthChange={setMonth}
          weekStartsOn={WEEK_STARTS_ON}
          actions={<Legend show={show} onToggle={toggle} />}
          // 격자는 그대로 두고 흐리게만 한다. 뼈대까지 갈아 끼우면 달력이 한 번 튄다.
          className={cn(isPending && 'animate-pulse opacity-60')}
          renderDay={(day) => {
            const items = days.get(day.iso) ?? []
            return (
              <button
                type="button"
                onClick={() => setSelected(day.iso)}
                aria-label={`${formatISODate(day.iso)} 일정 ${items.length}건`}
                className={cn(
                  'hover:bg-surface-hover flex h-full w-full flex-col items-start gap-0.5 rounded-md text-left transition-colors',
                  !day.inMonth && 'opacity-60',
                )}
              >
                <CalendarDayNumber day={day} />
                {items.slice(0, MAX_CHIPS).map((item) => (
                  <span
                    key={item.id}
                    className={cn(
                      'w-full truncate rounded px-1 text-[13px] leading-5',
                      TONE[item.group],
                    )}
                  >
                    {item.label}
                  </span>
                ))}
                {items.length > MAX_CHIPS && (
                  <span className="text-subtle px-1 text-[13px] leading-5">
                    +{items.length - MAX_CHIPS}
                  </span>
                )}
              </button>
            )
          }}
        />
      </Card>

      {selected && (
        <DayModal
          iso={selected}
          items={days.get(selected) ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </HomeSection>
  )
}

const LEGEND: Array<[CalendarGroup, string]> = [
  ['personal', '개인'],
  ['colleague', '동료'],
]

/**
 * 범례이자 토글. 견본을 체크박스 모양으로 그려 누를 수 있다는 걸 드러낸다. 켜진 것은 묶음 색에
 * 체크, 끈 것은 빈 칸(`Checkbox` 와 같은 테두리). 칸 안 순서(개인이 먼저)와 맞춘다.
 */
export function Legend({
  show,
  onToggle,
}: {
  show: Record<CalendarGroup, boolean>
  onToggle: (group: CalendarGroup) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {LEGEND.map(([group, label]) => (
        <button
          key={group}
          type="button"
          aria-pressed={show[group]}
          onClick={() => onToggle(group)}
          className="text-subtle hover:bg-surface-hover hover:text-fg flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap transition-colors"
        >
          <span
            className={cn(
              'grid size-3.5 place-items-center rounded-[3px] border',
              show[group] ? cn(DOT[group], 'border-transparent') : 'border-line-strong bg-canvas',
            )}
          >
            {show[group] && <Check className="text-on-accent size-3" strokeWidth={3} />}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}

function DayModal({
  iso,
  items,
  onClose,
}: {
  iso: string
  items: CalendarItem[]
  onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title={formatISODate(iso)} size="sm">
      <DayAgenda iso={iso} items={items} />
    </Modal>
  )
}

/** 그날의 항목 목록 + 내 일정 추가·삭제. 휴가는 여기서 손대지 않는다(근태 화면 몫). */
export function DayAgenda({ iso, items }: { iso: string; items: CalendarItem[] }) {
  const create = useCreateEvent()
  const remove = useDeleteEvent()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canSubmit = title.trim().length > 0 && !create.isPending

  const submit = () => {
    setError(null)
    create.mutate(
      { date: iso, title: title.trim(), time: time || null },
      {
        onSuccess: () => {
          setTitle('')
          setTime('')
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : '일정을 추가하지 못했습니다.'),
      },
    )
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-subtle text-sm">이날 일정이 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <span className={cn('size-2.5 shrink-0 rounded-sm', TONE[item.group])} />
              <span className="text-fg min-w-0 flex-1 truncate">{item.label}</span>
              {item.kind === 'event' && (
                <button
                  type="button"
                  aria-label={`${item.label} 삭제`}
                  disabled={remove.isPending && remove.variables === item.event.id}
                  onClick={() =>
                    remove.mutate(item.event.id, {
                      onError: () => toast.error('일정을 지우지 못했습니다.'),
                    })
                  }
                  className="text-subtle hover:text-danger rounded p-1 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Enter 로 바로 추가. 한 줄짜리 입력이라 폼 제출이 자연스럽다. */}
      <form
        className="border-line space-y-3 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) submit()
        }}
      >
        <Field label="내 일정 추가" error={error}>
          {(slot) => (
            <Input
              {...slot}
              value={title}
              maxLength={200}
              placeholder="예: 치과 예약"
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <div className="flex items-end gap-2">
          <Field label="시각" hint="비우면 종일" className="flex-1">
            {(slot) => (
              <Input {...slot} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            )}
          </Field>
          {/* 시각 필드의 힌트 줄만큼 띄워 입력과 버튼의 밑선을 맞춘다. 힌트(text-xs, mt-1.5)는
                줄 높이 16px + 위 여백 6px = 22px 다. */}
          <Button type="submit" size="sm" disabled={!canSubmit} className="mb-[22px]">
            {create.isPending ? (
              <Spinner className="border-t-on-accent" />
            ) : (
              <Plus className="size-4" />
            )}
            추가
          </Button>
        </div>
      </form>
    </div>
  )
}
