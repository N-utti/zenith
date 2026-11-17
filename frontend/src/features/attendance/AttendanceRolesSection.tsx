import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import type { Colleague } from '@/features/people/colleagues'
import { api, ApiError } from '@/lib/api'
import { useAttendanceRoles, useSetAttendanceRoles } from './api'

const NONE = ''

/**
 * 근태 담당자와 대표 지정(백엔드 README 76). 임원만 바꾼다(서버도 403).
 *
 * 근태 신청(휴가·예외 근무·연장·정정)의 결재가 담당자, 그다음 대표 순으로 올라간다. 담당자는 근태 현황,
 * 연차 관리, 근태 마감(마감·리포트·결근 처리)을 임원처럼 한다. 둘 다 비우면 예전처럼 팀장이나 첫 임원에게 간다.
 */
export function AttendanceRolesSection() {
  const roles = useAttendanceRoles()
  // 고르는 명단은 나까지 넣는다. 임원이 자신을 대표로 지정하는 것이 보통이다(`useColleagues` 는 나를 뺀다).
  const people = useQuery({
    queryKey: ['people'],
    queryFn: () => api<{ items: Colleague[] }>('/people'),
  })
  const save = useSetAttendanceRoles()
  const toast = useToast()
  // `null` 은 아직 안 건드림이라 서버 값이 시작점이다.
  const [manager, setManager] = useState<string | null>(null)
  const [ceo, setCeo] = useState<string | null>(null)

  const active = (people.data?.items ?? []).filter((p) => p.active)
  const managerId = manager ?? roles.data?.manager?.id ?? NONE
  const ceoId = ceo ?? roles.data?.ceo?.id ?? NONE
  const changed =
    managerId !== (roles.data?.manager?.id ?? NONE) || ceoId !== (roles.data?.ceo?.id ?? NONE)
  const options = (list: Colleague[]) => [
    { value: NONE, label: '지정 안 함' },
    ...list.map((p) => ({ value: p.id, label: p.team ? `${p.name} (${p.team.name})` : p.name })),
  ]

  const submit = () =>
    save.mutate(
      { manager_id: managerId || null, ceo_id: ceoId || null },
      {
        onSuccess: () => {
          setManager(null)
          setCeo(null)
          toast.success('근태 담당자와 대표를 저장했습니다.')
        },
      },
    )

  return (
    <Card className="p-4">
      <h2 className="text-fg text-sm font-semibold">근태 담당자와 대표</h2>
      <p className="text-muted mt-1 text-sm break-keep">
        근태 신청(휴가, 예외 근무, 연장, 정정)의 결재가 담당자, 그다음 대표 순으로 올라갑니다. 담당자는
        근태 현황과 연차 관리, 마감, 결근 처리를 맡습니다. 둘 다 비우면 팀장이나 임원에게 올라갑니다.
      </p>
      {roles.isPending || people.isPending ? (
        <Spinner className="mt-4" />
      ) : roles.isError || people.isError ? (
        <p className="text-danger mt-4 text-sm">불러오지 못했습니다.</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="근태 담당자">
            {(slot) => (
              <Select
                {...slot}
                value={managerId}
                onChange={(e) => {
                  setManager(e.target.value)
                  save.reset()
                }}
                options={options(active)}
              />
            )}
          </Field>
          <Field label="대표" hint="임원 중에서 고릅니다.">
            {(slot) => (
              <Select
                {...slot}
                value={ceoId}
                onChange={(e) => {
                  setCeo(e.target.value)
                  save.reset()
                }}
                options={options(active.filter((p) => p.role === 'exec'))}
              />
            )}
          </Field>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {save.error instanceof ApiError ? save.error.message : '저장하지 못했습니다.'}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={submit} disabled={!changed || save.isPending}>
          {save.isPending ? <Spinner className="border-t-on-accent" /> : '저장'}
        </Button>
      </div>
    </Card>
  )
}
