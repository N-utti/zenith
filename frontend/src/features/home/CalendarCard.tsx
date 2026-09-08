import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Calendar, CalendarDayNumber } from '@/components/ui/Calendar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { useAllLeaves, useLeaveTypes } from '@/features/attendance/api'
import { cn } from '@/lib/cn'
import { ApiError } from '@/lib/api'
import { currentMonth, formatISODate, monthMatrix, toISODate } from '@/lib/datetime'
import { useCreateEvent, useDeleteEvent, useMyEvents } from './api'
import { itemsByDay, type CalendarItem } from './calendarItems'
import { HomeSection } from './HomeSection'

/** 05 상태 색상 규약: 휴가는 파랑(accent). 내 일정은 초록. 색값은 `Badge` 의 accent·success 와 같다. */
const TONE: Record<CalendarItem['kind'], string> = {
  leave: 'bg-accent-soft text-accent',
  event: 'bg-success/12 text-success',
}

/** 칸 하나에 보이는 최대 줄 수. 넘치면 "+N" 으로 접고 눌러서 본다. */
const MAX_CHIPS = 3

/** 조회 기간과 격자가 같은 주 시작을 봐야 한다. 취업규칙이 일요일 시작이면 여기만 0 으로. */
const WEEK_STARTS_ON = 1

/** 홈 캘린더. 전 직원의 승인된 휴가 + 내 개인 일정. 날짜를 누르면 그날 항목과 일정 추가. */
export function CalendarCard() {
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState<string | null>(null)
  // 범례를 눌러 종류별로 끈다. 휴가만 보거나 내 일정만 보거나.
  const [show, setShow] = useState<Record<CalendarItem['kind'], boolean>>({
    leave: true,
    event: true,
  })
  const toggle = (kind: CalendarItem['kind']) => setShow((s) => ({ ...s, [kind]: !s[kind] }))

  // 보이는 칸(이웃 달 포함) 전체를 한 번에 묻는다. 달력에 빈 칸이 없어야 한다.
  const weeks = monthMatrix(month, WEEK_STARTS_ON)
  const range = {
    from: toISODate(weeks[0][0]),
    to: toISODate(weeks[weeks.length - 1][6]),
  }
  const leaves = useAllLeaves(range.from, range.to)
  const events = useMyEvents(range.from, range.to)
  const types = useLeaveTypes()
  const typeName = (code: string) => types.data?.items.find((t) => t.code === code)?.name ?? code
  const isError = leaves.isError || events.isError
  const isPending = leaves.isPending || events.isPending

  const days = itemsByDay(
    (show.leave && leaves.data?.items) || [],
    (show.event && events.data?.items) || [],
    typeName,
    range,
  )

  return (
    <HomeSection title="캘린더" to="/attendance" linkLabel="근태">
      <Card className="p-4">
        {isError && <CardEmpty>일정을 불러오지 못했습니다.</CardEmpty>}
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
                {/* 좁은 화면에서는 글자가 한 자씩만 남아 읽을 수 없다. 점으로 개수만 보이고 눌러서 본다. */}
                {items.length > 0 && (
                  <span className="flex flex-wrap gap-0.5 px-0.5 sm:hidden">
                    {items.slice(0, MAX_CHIPS).map((item) => (
                      <span
                        key={item.id}
                        className={cn('size-1.5 rounded-full', TONE[item.kind])}
                      />
                    ))}
                  </span>
                )}
                {items.slice(0, MAX_CHIPS).map((item) => (
                  <span
                    key={item.id}
                    className={cn(
                      'hidden w-full truncate rounded px-1 text-[11px] leading-4 sm:block',
                      TONE[item.kind],
                    )}
                  >
                    {item.label}
                  </span>
                ))}
                {items.length > MAX_CHIPS && (
                  <span className="text-subtle hidden px-1 text-[11px] leading-4 sm:block">
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

const LEGEND: Array<[CalendarItem['kind'], string]> = [
  ['leave', '휴가'],
  ['event', '내 일정'],
]

/** 범례이자 토글. 끈 종류는 흐리게. */
function Legend({
  show,
  onToggle,
}: {
  show: Record<CalendarItem['kind'], boolean>
  onToggle: (kind: CalendarItem['kind']) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {LEGEND.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          aria-pressed={show[kind]}
          onClick={() => onToggle(kind)}
          className={cn(
            'text-subtle hover:bg-surface-hover hover:text-fg flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
            !show[kind] && 'opacity-50',
          )}
        >
          <span className={cn('size-2.5 rounded-sm', TONE[kind])} />
          {label}
        </button>
      ))}
    </div>
  )
}

/** 그날의 항목 목록 + 내 일정 추가·삭제. 휴가는 여기서 손대지 않는다(근태 화면 몫). */
function DayModal({
  iso,
  items,
  onClose,
}: {
  iso: string
  items: CalendarItem[]
  onClose: () => void
}) {
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
    <Modal open onClose={onClose} title={formatISODate(iso)} size="sm">
      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="text-subtle text-sm">이날 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className={cn('size-2.5 shrink-0 rounded-sm', TONE[item.kind])} />
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
                <Input
                  {...slot}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              )}
            </Field>
            {/* 시각 필드의 힌트 줄만큼 띄워 입력과 버튼의 밑선을 맞춘다. */}
            <Button type="submit" size="sm" disabled={!canSubmit} className="mb-[26px]">
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
    </Modal>
  )
}
