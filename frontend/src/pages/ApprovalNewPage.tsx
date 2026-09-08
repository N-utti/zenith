import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import {
  useApproval,
  useCreateDraft,
  useSubmitApproval,
  useUpdateDraft,
} from '@/features/approvals/api'
import { useMyArrangements } from '@/features/attendance/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'

/**
 * 기안 작성(13 SCR-APV-01). v1 최소판은 일반 기안 한 종류다. 근태 4종은 근태 화면의 신청이 곧 기안이다.
 *
 * `?arrangement=<id>` 로 열면 출장비 결의서다. 출장 기간·사유를 미리 채우고 문서를 그 출장에 건다.
 * `?draft=<id>` 로 열면 임시저장을 이어 쓴다.
 * ponytail: 첨부(영수증)는 파일 업로드(FR-APV-05)가 결재 열람 권한과 묶여야 해서 뒤로 미뤘다.
 * 결재선 미리보기도 서버가 만들어 주는 값이라 상신 뒤 상세에서 본다.
 */
export function ApprovalNewPage() {
  const [params] = useSearchParams()
  const arrangementId = params.get('arrangement')
  const draftId = params.get('draft') ?? ''
  const navigate = useNavigate()
  const toast = useToast()
  const user = useCurrentUser()
  const arrangements = useMyArrangements(!!arrangementId)
  const draft = useApproval(draftId)
  const create = useCreateDraft()
  const update = useUpdateDraft()
  const submit = useSubmitApproval()

  const trip = arrangementId
    ? arrangements.data?.items.find((a) => a.id === arrangementId && a.kind === 'trip')
    : undefined
  const tripPeriod = trip
    ? trip.start_date === trip.end_date
      ? trip.start_date
      : `${trip.start_date} ~ ${trip.end_date}`
    : ''

  const [title, setTitle] = useState<string | null>(null)
  const [amount, setAmount] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 상신이 실패해도 방금 만든 임시저장을 잃지 않는다. 다음 시도는 새로 만들지 않고 이것을 고친다.
  const [createdId, setCreatedId] = useState<string | null>(null)

  // 임시저장·출장 정보가 오기 전에 빈 폼을 보이면, 그 사이 입력이 도착한 값과 뒤섞이고
  // 저장하면 문서가 하나 더 생긴다. 다 올 때까지 기다린다.
  if (draftId && draft.isPending) return <SkeletonRows rows={4} />
  if (draftId && draft.isError) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted text-sm">임시저장을 불러오지 못했습니다.</p>
        <Link
          to="/approvals?box=draft"
          className="text-accent mt-4 inline-block text-sm hover:underline"
        >
          임시저장함으로
        </Link>
      </div>
    )
  }
  if (arrangementId && arrangements.isPending) return <SkeletonRows rows={4} />

  // 첫 렌더 값: 임시저장 → 출장 채움 → 빈 폼 순. 입력을 시작하면 그 값이 이긴다.
  const seed = draft.data
  const titleValue = title ?? seed?.title ?? (trip ? `출장비 결의서 (${tripPeriod})` : '')
  const amountValue = amount ?? (seed?.amount != null ? String(seed.amount) : '')
  const bodyValue =
    body ??
    seed?.subject.body ??
    (trip ? `출장 기간: ${tripPeriod}\n출장 목적: ${trip.reason}\n\n지출 내역:\n- ` : '')
  const related = seed?.related ?? (trip ? { type: 'arrangement' as const, id: trip.id } : null)

  const amountNumber = amountValue.trim() === '' ? null : Number(amountValue.replace(/,/g, ''))
  const amountError =
    amountNumber !== null && (!Number.isFinite(amountNumber) || amountNumber < 0)
      ? '금액은 0 이상의 숫자입니다.'
      : null
  const busy = create.isPending || update.isPending || submit.isPending
  const canSave = titleValue.trim().length > 0 && !amountError && !busy

  const input = {
    type_code: 'general' as const,
    title: titleValue.trim(),
    subject: { body: bodyValue, amount: amountNumber, related },
  }
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : '저장하지 못했습니다.')

  /** 임시저장이 있으면 갱신, 없으면 생성. 상신은 그 뒤에 한 번 더. */
  const save = (thenSubmit: boolean) => {
    setError(null)
    const after = (id: string) => {
      if (!thenSubmit) {
        toast.success('임시저장했습니다.')
        void navigate(`/approvals/${id}`)
        return
      }
      submit.mutate(id, {
        onSuccess: () => {
          toast.success('상신했습니다. 결재가 끝나면 알려 드립니다.')
          void navigate(`/approvals/${id}`)
        },
        onError: fail,
      })
    }
    const existing = seed?.id ?? createdId
    if (existing) {
      update.mutate({ id: existing, ...input }, { onSuccess: (d) => after(d.id), onError: fail })
    } else {
      create.mutate(input, {
        onSuccess: (d) => {
          setCreatedId(d.id)
          after(d.id)
        },
        onError: fail,
      })
    }
  }

  return (
    <>
      <Link to="/approvals" className="text-subtle hover:text-fg mb-3 inline-block text-sm">
        ← 결재함
      </Link>
      <PageHeader
        title={trip ? '출장비 결의서' : '새 기안'}
        description={
          trip
            ? `${tripPeriod} 출장에 딸린 지출 결의서입니다. 결재선: 팀장 → 임원.`
            : `일반 기안. 결재선은 상신할 때 정해집니다(팀장 → 임원). 기안자: ${user.name}`
        }
      />
      <Card>
        <CardHeader title="내용" />
        <div className="space-y-4 px-5 pb-5">
          <Field label="제목" required>
            {(slot) => (
              <Input
                {...slot}
                value={titleValue}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="금액"
            hint="지출이 없으면 비웁니다. 전결 판정에 쓰입니다."
            error={amountError}
          >
            {(slot) => (
              <Input
                {...slot}
                inputMode="numeric"
                placeholder="0"
                value={amountValue}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
          <Field label="본문" required>
            {(slot) => (
              <Textarea
                {...slot}
                rows={10}
                value={bodyValue}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={!canSave} onClick={() => save(false)}>
              임시저장
            </Button>
            <Button
              size="sm"
              disabled={!canSave || bodyValue.trim().length === 0}
              onClick={() => save(true)}
            >
              {busy ? <Spinner className="border-t-on-accent" /> : '상신'}
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
