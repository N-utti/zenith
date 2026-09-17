import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { useColleagues } from '@/features/people/colleagues'
import { ApiError } from '@/lib/api'
import { formatISOYearDate, toISODate } from '@/lib/datetime'
import { useApprovalTypes, useCreateDelegation, useDelegations, useDeleteDelegation } from './api'
import { APPROVAL_TYPE_LABEL, type ApprovalTypeCode } from './types'

const ALL_TYPES = ''

/**
 * 결재 위임(13 §4.2.3). 자리를 비우는 동안 대신 결재할 사람을 정한다.
 *
 * 설정에 둔다. 결재함 탭은 문서 목록이고 위임은 내 계정에 붙는 값이다.
 *
 * 모든 문서 유형을 위임할 수 있는 건 아니다. 유형마다 서버가 허용 여부를 들고 있어서
 * (`allow_delegate_decision`) 켜진 것만 고를 수 있다.
 */
export function DelegationSection() {
  const { data, isPending, isError } = useDelegations()
  const types = useApprovalTypes()
  const { people, isError: peopleError } = useColleagues()
  const create = useCreateDelegation()
  const remove = useDeleteDelegation()
  const toast = useToast()

  const today = toISODate(new Date())
  const [delegate, setDelegate] = useState('')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState('')
  const [typeCode, setTypeCode] = useState<string>(ALL_TYPES)
  const [error, setError] = useState<string | null>(null)

  const delegatable = (types.data?.items ?? []).filter((type) => type.allow_delegate_decision)
  const busy = create.isPending || remove.isPending
  const ready = delegate !== '' && start !== '' && end !== '' && start <= end

  const add = () => {
    if (!ready || busy) return
    setError(null)
    create.mutate(
      {
        delegate_id: delegate,
        start_date: start,
        end_date: end,
        type_code: typeCode === ALL_TYPES ? null : (typeCode as ApprovalTypeCode),
      },
      {
        onSuccess: (made) => {
          setDelegate('')
          setEnd('')
          setTypeCode(ALL_TYPES)
          toast.success(`${made.delegate.name} 님에게 위임했습니다.`)
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : '위임하지 못했습니다.'),
      },
    )
  }

  return (
    <section className="border-line bg-surface mt-4 rounded-xl border p-6">
      <h2 className="text-fg mb-1 text-sm font-semibold">결재 위임</h2>
      <p className="text-muted mb-4 text-sm">
        자리를 비우는 동안 대신 결재할 사람을 정합니다. 문서에는 원래 결재자 이름이 남고 실제
        처리자가 함께 표시됩니다.
      </p>

      {isPending && <SkeletonRows rows={2} />}
      {isError && <p className="text-muted text-sm">위임 목록을 불러오지 못했습니다.</p>}

      {data &&
        (data.items.length === 0 ? (
          <p className="text-subtle text-sm">걸어 둔 위임이 없습니다.</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm font-medium">
                    {item.delegate.name}
                    <span className="text-muted ml-1.5 font-normal">
                      {item.type_code ? APPROVAL_TYPE_LABEL[item.type_code] : '모든 유형'}
                    </span>
                  </p>
                  <p className="text-subtle text-xs">
                    {formatISOYearDate(item.start_date)} ~ {formatISOYearDate(item.end_date)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${item.delegate.name} 위임 해제`}
                  disabled={busy}
                  onClick={() =>
                    remove.mutate(item.id, {
                      onSuccess: () => toast.success('위임을 해제했습니다.'),
                      onError: (err) =>
                        toast.error(err instanceof ApiError ? err.message : '해제하지 못했습니다.'),
                    })
                  }
                >
                  {remove.isPending && remove.variables === item.id ? (
                    <Spinner />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        ))}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="대신 결재할 사람"
          error={peopleError ? '사람 목록을 불러오지 못했습니다.' : null}
        >
          {(slot) => (
            <Select
              {...slot}
              placeholder="고르세요"
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              options={people.map((person) => ({ value: person.id, label: person.name }))}
            />
          )}
        </Field>
        <Field label="문서 유형" hint="위임할 수 있는 유형만 나옵니다.">
          {(slot) => (
            <Select
              {...slot}
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
              options={[
                { value: ALL_TYPES, label: '모든 유형' },
                ...delegatable.map((type) => ({ value: type.code, label: type.name })),
              ]}
            />
          )}
        </Field>
        <Field label="시작일">
          {(slot) => (
            <Input {...slot} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          )}
        </Field>
        <Field
          label="종료일"
          error={end !== '' && start > end ? '종료일이 시작일보다 앞섭니다.' : null}
        >
          {(slot) => (
            <Input
              {...slot}
              type="date"
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          )}
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!ready || busy} onClick={add}>
          {create.isPending ? <Spinner className="border-t-on-accent" /> : '위임 걸기'}
        </Button>
      </div>
    </section>
  )
}
