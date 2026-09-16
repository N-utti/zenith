import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { YearHeader } from '@/components/ui/Calendar'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { currentMonth, formatISODate } from '@/lib/datetime'
import { useAddHoliday, useHolidays, useRemoveHoliday } from './api'

/**
 * 회사 휴일(임원, FR-ATT-11 · 10 §6). 넣고 빼면 근태 달력이 바로 바뀐다. 마감된 달의 날짜는 서버가 409 로 막는다(§6.2).
 * 법정 공휴일은 여기서 다루지 않는다(2026-09-16 결정). 달력에는 있지만 이 화면에 보이지도 고쳐지지도 않는다.
 * 휴가 종류·연차 부여 기준 설정도 없다.
 */
export function HolidaySection() {
  const [year, setYear] = useState(() => Number(currentMonth().slice(0, 4)))
  const holidays = useHolidays(year)
  const remove = useRemoveHoliday()
  const toast = useToast()
  // 법정 공휴일은 서버가 관리한다. 여기서는 회사 휴일만.
  const items = (holidays.data?.items ?? []).filter((h) => h.kind === 'company')

  const onRemove = (date: string, name: string) => {
    // 전 직원 근무 달력이 바뀌는 일이라 한 번 묻는다. 자기 신청 취소도 이렇게 한다(LeaveSection).
    if (!confirm(`${formatISODate(date)} ${name} 을 휴일에서 뺄까요?`)) return
    remove.mutate(date, {
      onSuccess: () => toast.success(`회사 휴일에서 뺐습니다: ${formatISODate(date)} ${name}`),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : '휴일을 지우지 못했습니다.'),
    })
  }

  return (
    <div className="space-y-4">
      <YearHeader
        year={year}
        onYearChange={setYear}
        actions={
          <p className="text-subtle text-xs">
            창립기념일·종무식 같은 회사 휴일. 법정 공휴일은 여기서 다루지 않습니다. 마감된 달의
            날짜는 바꿀 수 없습니다.
          </p>
        }
      />

      {/* 연도를 옮기면 폼도 비운다. 남은 날짜가 새 연도의 min/max 밖에 걸려 브라우저 말풍선이 뜬다. */}
      <AddHolidayForm key={year} year={year} />

      <Table>
        <THead>
          <tr>
            <TH>날짜</TH>
            <TH>이름</TH>
            <TH className="text-right">
              <span className="sr-only">동작</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {holidays.isPending && <TableEmpty colSpan={3}>불러오는 중</TableEmpty>}
          {holidays.isError && (
            <TableEmpty colSpan={3}>
              {holidays.error instanceof ApiError
                ? holidays.error.message
                : '휴일 목록을 불러오지 못했습니다.'}
            </TableEmpty>
          )}
          {holidays.data && items.length === 0 && (
            <TableEmpty colSpan={3}>{year}년에 등록된 회사 휴일이 없습니다.</TableEmpty>
          )}
          {items.map((h) => {
            return (
              <TR key={h.date}>
                {/* formatISODate 가 요일까지 붙인다. */}
                <TD className="whitespace-nowrap tabular-nums">{formatISODate(h.date)}</TD>
                <TD>{h.name}</TD>
                <TD className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(h.date, h.name)}
                    disabled={remove.isPending && remove.variables === h.date}
                    aria-label={`${formatISODate(h.date)} ${h.name} 삭제`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </div>
  )
}

function AddHolidayForm({ year }: { year: number }) {
  const add = useAddHoliday()
  const toast = useToast()
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canSubmit = !!date && name.trim().length > 0 && !add.isPending

  const submit = () => {
    setError(null)
    add.mutate(
      { date, name: name.trim(), kind: 'company' },
      {
        onSuccess: (item) => {
          setDate('')
          setName('')
          toast.success(`회사 휴일로 등록했습니다: ${formatISODate(item.date)} ${item.name}`)
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : '휴일을 등록하지 못했습니다.'),
      },
    )
  }

  return (
    <Card className="p-4">
      <form
        className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) submit()
        }}
      >
        <Field label="날짜" required>
          {(slot) => (
            <Input
              {...slot}
              type="date"
              value={date}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="이름" required>
          {(slot) => (
            <Input
              {...slot}
              value={name}
              maxLength={100}
              placeholder="예: 창립기념일, 종무식"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="sm" disabled={!canSubmit} className="h-10">
          {add.isPending ? <Spinner className="border-t-on-accent" /> : '추가'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
    </Card>
  )
}
