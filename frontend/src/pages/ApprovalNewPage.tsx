import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
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
  uploadApprovalAttachment,
  useApproval,
  useCreateDraft,
  useSubmitApproval,
  useUpdateDraft,
} from '@/features/approvals/api'
import { AttachmentList } from '@/features/approvals/AttachmentList'
import type { ApprovalAttachment } from '@/features/approvals/types'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/features/chat/api'
import { useMyArrangements } from '@/features/attendance/api'
import { useColleagues } from '@/features/people/colleagues'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { cn } from '@/lib/cn'

/**
 * 기안 작성(13 SCR-APV-01). v1 최소판은 일반 기안 한 종류다. 근태 4종은 근태 화면의 신청이 곧 기안이다.
 *
 * `?arrangement=<id>` 로 열면 출장비 결의서다. 출장 기간·사유를 미리 채우고 문서를 그 출장에 건다.
 * `?draft=<id>` 로 열면 임시저장을 이어 쓴다.
 * 첨부(영수증, FR-APV-05)는 문서에 딸려 올라가서 문서 id 가 있어야 한다. 고른 파일은 들고 있다가
 * 저장할 때 올린다. 새 기안이면 먼저 임시저장을 만들고, 올린 뒤 첨부 목록을 한 번 더 저장한다.
 * 결재선 미리보기는 서버가 만들어 주는 값이라 상신 뒤 상세에서 본다.
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
  /** 고른 참조자. 임시저장을 열면 저장돼 있던 것으로 시작한다. */
  const [references, setReferences] = useState<string[] | null>(null)
  const { people, isPending: peoplePending, isError: peopleError } = useColleagues()
  // 상신이 실패해도 방금 만든 임시저장을 잃지 않는다. 다음 시도는 새로 만들지 않고 이것을 고친다.
  const [createdId, setCreatedId] = useState<string | null>(null)
  /** 올려 둔 첨부. `null` 은 아직 안 건드림이라 임시저장에 있던 것이 시작점이다. */
  const [attachments, setAttachments] = useState<ApprovalAttachment[] | null>(null)
  /** 골랐지만 아직 안 올린 파일. 저장할 때 올린다. */
  const [pending, setPending] = useState<File[]>([])
  /**
   * 저장 한 번(생성·업로드·갱신·상신)이 도는 동안. 요청 하나하나의 진행 상태를 OR 로 묶으면
   * 요청 사이에 한 박자 풀리는 틈이 생겨 두 번 눌린다. 저장 전체를 이 값 하나로 잠근다.
   */
  const [saving, setSaving] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

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
  // 임시저장에는 참조자가 결재선에 섞여 저장돼 있다. 역할로 갈라 낸다.
  const savedReferences =
    seed?.steps.filter((step) => step.role === 'reference').map((step) => step.approver.id) ?? []
  const referenceIds = references ?? savedReferences
  const toggleReference = (id: string) =>
    // 저장돼 있던 값에서 출발한다. `null` 은 "아직 안 건드림" 이라 그때는 그 값이 시작점이다.
    setReferences((prev) => {
      const current = prev ?? savedReferences
      return current.includes(id) ? current.filter((each) => each !== id) : [...current, id]
    })

  const attached = attachments ?? seed?.subject.attachments ?? []

  const pick = (list: FileList | null) => {
    const chosen = [...(list ?? [])]
    if (chosen.length === 0) return
    setError(null)
    if (attached.length + pending.length + chosen.length > MAX_ATTACHMENTS) {
      return setError(`파일은 ${MAX_ATTACHMENTS}개까지 붙일 수 있습니다.`)
    }
    // 서버도 막지만(422) 여기서 먼저 걸러야 10MB 를 다 올린 뒤에 거절당하지 않는다.
    const bad = chosen.find((file) => file.size === 0 || file.size > MAX_ATTACHMENT_BYTES)
    if (bad) return setError(`${bad.name}: 비어 있지 않은 10MB 이하 파일만 붙일 수 있습니다.`)
    setPending((prev) => [...prev, ...chosen])
  }

  const amountNumber = amountValue.trim() === '' ? null : Number(amountValue.replace(/,/g, ''))
  const amountError =
    amountNumber !== null && (!Number.isFinite(amountNumber) || amountNumber < 0)
      ? '금액은 0 이상의 숫자입니다.'
      : null
  const busy = saving
  const canSave = titleValue.trim().length > 0 && !amountError && !busy

  const input = {
    type_code: 'general' as const,
    title: titleValue.trim(),
    subject: { body: bodyValue, amount: amountNumber, related, attachments: attached },
    references: referenceIds,
  }
  const fail = (err: unknown, prefix = '') =>
    setError(prefix + (err instanceof ApiError ? err.message : '저장하지 못했습니다.'))

  /**
   * 임시저장이 있으면 갱신, 없으면 생성. 고른 파일이 있으면 올리고 첨부 목록을 저장한다. 상신은 그 뒤에.
   *
   * 중간에 실패해도 이미 올린 파일은 첨부 목록으로, 만든 임시저장은 `createdId` 로 남는다.
   * 다시 누르면 남은 파일만 올리고 같은 문서를 고친다. 도는 동안 입력칸은 잠근다(`fieldset`).
   * 요청 본문은 누른 순간의 값이라, 그 사이 고친 글은 저장되지 않고 사라진다.
   */
  const save = async (thenSubmit: boolean) => {
    setError(null)
    setSaving(true)
    /** 올리던 파일. 실패 문구에 이름을 붙여 몇 번째에서 멈췄는지 보인다. */
    let current: File | null = null
    try {
      let id = seed?.id ?? createdId
      const fresh = !id
      if (!id) {
        id = (await create.mutateAsync(input)).id
        setCreatedId(id)
      }
      const uploaded = [...attached]
      for (const file of pending) {
        current = file
        uploaded.push(await uploadApprovalAttachment(id, file))
        setAttachments([...uploaded])
        setPending((prev) => prev.filter((each) => each !== file))
      }
      current = null
      // 방금 만들었고 올린 것도 없으면 이미 저장된 그대로다.
      if (!fresh || uploaded.length > attached.length) {
        await update.mutateAsync({
          id,
          ...input,
          subject: { ...input.subject, attachments: uploaded },
        })
      }
      if (thenSubmit) {
        await submit.mutateAsync(id)
        toast.success('상신했습니다. 결재가 끝나면 알려 드립니다.')
      } else {
        toast.success('임시저장했습니다.')
      }
      void navigate(`/approvals/${id}`)
    } catch (err) {
      fail(err, current ? `${current.name}: ` : '')
    } finally {
      setSaving(false)
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
            ? `${tripPeriod} 출장에 딸린 지출 결의서입니다.`
            : `일반 기안. 결재선은 상신할 때 정해집니다. 기안자: ${user.name}`
        }
      />
      <Card>
        <CardHeader title="내용" />
        <fieldset disabled={busy} className="min-w-0 space-y-4 px-5 pb-5">
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
          <Field
            label="참조"
            hint="결재는 하지 않지만 문서를 볼 사람입니다. 결재선에 오른 사람은 빠집니다."
            error={peopleError ? '참조자 목록을 불러오지 못했습니다.' : null}
          >
            {(slot) => (
              <div
                role="group"
                aria-label="참조자"
                aria-describedby={slot['aria-describedby']}
                className="flex flex-wrap gap-1.5"
              >
                {peoplePending && <Spinner />}
                {!peoplePending && !peopleError && people.length === 0 && (
                  <p className="text-subtle text-sm">고를 수 있는 사람이 없습니다.</p>
                )}
                {people.map((each) => {
                  const picked = referenceIds.includes(each.id)
                  return (
                    <button
                      key={each.id}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggleReference(each.id)}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs transition-colors',
                        picked
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line text-muted hover:bg-surface-hover',
                      )}
                    >
                      <Avatar name={each.name} hue={hueOf(each.id)} size="sm" />
                      {each.name}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>
          <Field
            label="첨부"
            hint={`영수증·견적서. 파일당 10MB, ${MAX_ATTACHMENTS}개까지. 이 문서를 열 수 있는 사람만 받습니다.`}
          >
            {(slot) => (
              <div role="group" aria-label="첨부" className="space-y-2">
                <AttachmentList
                  files={[...attached, ...pending]}
                  onRemove={
                    busy
                      ? undefined
                      : (index) =>
                          index < attached.length
                            ? setAttachments(attached.filter((_, i) => i !== index))
                            : setPending((prev) =>
                                prev.filter((_, i) => i !== index - attached.length),
                              )
                  }
                />
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    pick(e.target.files)
                    // 같은 파일을 다시 고를 수 있게 비운다.
                    e.target.value = ''
                  }}
                />
                {/* `id` 는 넘기지 않는다. 라벨이 붙으면 버튼 이름이 "첨부" 로 덮여 보이는 글자와 갈린다. */}
                <Button
                  aria-describedby={slot['aria-describedby']}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => picker.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                  파일 붙이기
                </Button>
              </div>
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
            <Button
              variant="secondary"
              size="sm"
              disabled={!canSave}
              onClick={() => void save(false)}
            >
              임시저장
            </Button>
            <Button
              size="sm"
              disabled={!canSave || bodyValue.trim().length === 0}
              onClick={() => void save(true)}
            >
              {busy ? <Spinner className="border-t-on-accent" /> : '상신'}
            </Button>
          </div>
        </fieldset>
      </Card>
    </>
  )
}
