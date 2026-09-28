import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useColleagues } from '@/features/people/colleagues'
import { ApiError } from '@/lib/api'
import { toDateTimeLocal } from '@/lib/datetime'
import {
  useCreateDeal,
  useCreateOrg,
  useDeals,
  useOrgs,
  useSaveActivity,
  useSaveContact,
  useUpdateDeal,
  useUpdateOrg,
} from './api'
import { ChipPicker } from './ChipPicker'
import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_KIND_LABEL,
  ACTIVITY_KINDS,
  MEMO_MAX,
  ORG_NAME_MAX,
  ORG_TYPE_LABEL,
  ORG_TYPES,
  DEAL_KIND_LABEL,
  DEAL_KINDS,
  DEAL_NAME_MAX,
  DEAL_STATUS_LABEL,
  contactName,
  type Activity,
  type ActivityKind,
  type Contact,
  type DealDetail,
  type DealKind,
  type OrgDetail,
  type OrgType,
  type Person,
} from './types'

/**
 * 창구·사내 참석자로 고를 사람. 동료 명단은 나를 빼고 오지만(결재·DM 에서 나를 고를 일이 없다)
 * 여기서는 내가 맡거나 내가 다녀온 미팅이 제일 흔하다. 나를 맨 앞에 붙인다.
 */
function useStaff(): Person[] {
  const me = useCurrentUser()
  const { people } = useColleagues()
  return [{ id: me.id, name: me.name }, ...people]
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

/** 세 폼이 같이 쓰는 껍데기. Enter 로도 저장되게 폼을 모달 본문에 두고 버튼을 `form=` 으로 잇는다. */
function FormModal({
  title,
  description,
  busy,
  error,
  submitLabel = '저장',
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  description?: string
  busy: boolean
  error: string | null
  submitLabel?: string
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
}) {
  const formId = useId()
  // 저장 중에는 닫지도 고치지도 못하게 한다. 요청이 둘로 이어지는 폼(담당자 수정의 새 기관 등록)은
  // 도중에 닫으면 앞의 것만 서버에 남고, 도중에 고친 값은 저장되지 않은 채 «저장했습니다» 로 닫힌다.
  const close = busy ? () => {} : onClose
  return (
    <Modal
      open
      onClose={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
            취소
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={!canSubmit || busy}>
            {busy ? <Spinner className="border-t-on-accent" /> : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (canSubmit && !busy) onSubmit()
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {children}
        </fieldset>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

const TYPE_OPTIONS = ORG_TYPES.map((value) => ({ value, label: ORG_TYPE_LABEL[value] }))

/** 담당자 수정의 소속 기관 선택지 끝에 붙는 «새 기관 등록». 기관 id 와 겹치지 않는 값. */
const NEW_ORG = '__new'

/** 기관 등록·수정. `org` 가 없으면 등록이고, 저장하면 새 기관 상세로 간다. */
export function OrgFormModal({ org, onClose }: { org?: OrgDetail; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const staff = useStaff()
  const create = useCreateOrg()
  const update = useUpdateOrg()
  const [name, setName] = useState(org?.name ?? '')
  const [orgType, setOrgType] = useState<OrgType | ''>(org?.org_type ?? '')
  const [owners, setOwners] = useState(org?.owners.map((o) => o.id) ?? [])
  const [memo, setMemo] = useState(org?.memo ?? '')
  const [error, setError] = useState<string | null>(null)

  // 퇴사 등으로 명단에서 빠진 기존 창구도 칩으로 남겨야 풀 수 있다.
  const ownerOptions = [
    ...staff,
    ...(org?.owners.filter((o) => !staff.some((s) => s.id === o.id)) ?? []),
  ]

  const submit = () => {
    if (!orgType) return
    setError(null)
    const input = { name: name.trim(), org_type: orgType, memo, owner_ids: owners }
    if (org) {
      update.mutate(
        { id: org.id, ...input },
        {
          onSuccess: () => {
            toast.success('저장했습니다.')
            onClose()
          },
          onError: (err) => setError(errorText(err, '저장하지 못했습니다.')),
        },
      )
      return
    }
    create.mutate(input, {
      onSuccess: ({ org: made, duplicates }) => {
        // 막지는 않는다. 계열사처럼 이름이 겹쳐도 다른 기관일 수 있다(15 FR-CRM-01).
        if (duplicates.length > 0) {
          toast.info(
            `이름이 같은 기관이 이미 있습니다: ${duplicates.map((d) => d.name).join(', ')}`,
          )
        } else {
          toast.success('등록했습니다.')
        }
        onClose()
        void navigate(`/crm/orgs/${made.id}`)
      },
      onError: (err) => setError(errorText(err, '등록하지 못했습니다.')),
    })
  }

  return (
    <FormModal
      title={org ? '기관 수정' : '기관 등록'}
      busy={create.isPending || update.isPending}
      error={error}
      canSubmit={name.trim().length > 0 && orgType !== ''}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="기관 이름" required>
        {(slot) => (
          <Input
            {...slot}
            value={name}
            maxLength={ORG_NAME_MAX}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="유형" required>
        {(slot) => (
          <Select
            {...slot}
            value={orgType}
            placeholder="유형 선택"
            options={TYPE_OPTIONS}
            onChange={(e) => setOrgType(e.target.value as OrgType)}
          />
        )}
      </Field>
      <Field label="사내 창구" hint="이 기관을 맡은 우리 쪽 사람입니다.">
        {(slot) => (
          <ChipPicker
            slot={slot}
            label="사내 창구"
            options={ownerOptions}
            value={owners}
            onChange={setOwners}
          />
        )}
      </Field>
      <Field label="메모">
        {(slot) => (
          <Textarea
            {...slot}
            rows={3}
            value={memo}
            maxLength={MEMO_MAX}
            onChange={(e) => setMemo(e.target.value)}
          />
        )}
      </Field>
    </FormModal>
  )
}

/**
 * 담당자 등록·수정. 수정에서 소속 기관을 바꾸면 이직이다(15 FR-CRM-04). 서버가 이전 소속을
 * 이력으로 남기고, 옛 활동 기록은 기록 당시 기관에 그대로 둔다.
 */
export function ContactFormModal({
  orgId,
  contact,
  onClose,
}: {
  orgId: string
  contact?: Contact
  onClose: () => void
}) {
  const toast = useToast()
  const save = useSaveContact()
  const createOrg = useCreateOrg()
  // 기관은 수십 곳이라 선택 상자로 충분하다. 등록은 지금 보고 있는 기관에 붙으니 수정 때만 쓴다.
  const orgs = useOrgs({ q: '', type: '', owner: '', staleDays: 0 }, !!contact)
  const orgOptions = [
    ...(orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.name })),
    { value: NEW_ORG, label: '+ 새 기관 등록' },
  ]
  const [toOrg, setToOrg] = useState(orgId)
  // 옮겨 갈 기관이 주소록에 없으면 이 창에서 바로 만든다. 창을 닫고 기관부터 등록하면 적던 게 날아간다.
  const [newOrg, setNewOrg] = useState<{ name: string; org_type: OrgType | '' }>({
    name: '',
    org_type: '',
  })
  const creatingOrg = toOrg === NEW_ORG
  const moving = toOrg !== orgId
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    title: contact?.title ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    memo: contact?.memo ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value })

  /** `made` 는 이 저장 직전에 새로 등록한 기관. 저장이 실패해도 기관은 남았다는 걸 알려야 한다. */
  const saveContact = (to: string, made?: { name: string }) =>
    save.mutate(
      { id: contact?.id, ...form, org_id: contact && to === orgId ? undefined : to },
      {
        onSuccess: () => {
          toast.success(
            to !== orgId
              ? `${made?.name ?? orgOptions.find((o) => o.value === to)?.label ?? '다른 기관'}(으)로 옮겼습니다.`
              : '저장했습니다.',
          )
          onClose()
        },
        onError: (err) => {
          const why = errorText(err, '담당자를 저장하지 못했습니다.')
          setError(made ? `기관 «${made.name}» 등록은 끝났습니다. ${why}` : why)
        },
      },
    )

  const submit = () => {
    setError(null)
    if (!creatingOrg) return saveContact(toOrg)
    if (!newOrg.org_type) return
    createOrg.mutate(
      { name: newOrg.name.trim(), org_type: newOrg.org_type, memo: '', owner_ids: [] },
      {
        onSuccess: ({ org: made, duplicates }) => {
          // 막지는 않는다(15 FR-CRM-01). 다만 있던 기관을 못 보고 또 만든 것일 수 있으니 알린다.
          if (duplicates.length > 0) {
            toast.info(
              `이름이 같은 기관이 이미 있습니다: ${duplicates.map((d) => d.name).join(', ')}`,
            )
          }
          // 기관은 생겼다. 담당자 저장이 실패해도 다시 누를 때 기관을 또 만들지 않게 선택을 옮겨 둔다.
          setToOrg(made.id)
          saveContact(made.id, made)
        },
        onError: (err) => setError(errorText(err, '기관을 등록하지 못했습니다.')),
      },
    )
  }

  const text = (key: 'name' | 'title' | 'phone' | 'email', label: string, type = 'text') => (
    <Field label={label} required={key === 'name'}>
      {(slot) => (
        <Input
          {...slot}
          type={type}
          value={form[key]}
          autoFocus={key === 'name'}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </Field>
  )

  return (
    <FormModal
      title={contact ? '담당자 수정' : '담당자 추가'}
      description="회사 밖 사람의 개인정보입니다. 업무 연락에 필요한 만큼만 적어 주세요."
      busy={save.isPending || createOrg.isPending}
      error={error}
      canSubmit={
        form.name.trim().length > 0 &&
        (!creatingOrg || (newOrg.name.trim().length > 0 && newOrg.org_type !== ''))
      }
      onClose={onClose}
      onSubmit={submit}
    >
      {text('name', '이름')}
      {contact && (
        <Field
          label="소속 기관"
          hint={
            creatingOrg
              ? '저장하면 기관을 등록하고 그 기관으로 옮깁니다. 창구·메모는 기관 상세에서 채워 주세요.'
              : moving
                ? '이 기관 담당자 목록에서 빠지고 이전 소속은 이력으로 남습니다. 지난 활동 기록은 이 기관에 그대로 있습니다.'
                : '이직했으면 새 기관으로 바꿔 주세요.'
          }
        >
          {(slot) => (
            <Select
              {...slot}
              value={toOrg}
              options={orgOptions}
              // 목록이 오기 전에는 지금 기관이 선택지에 없어 빈칸으로 보인다. 잠가 둔다.
              disabled={orgs.isPending}
              onChange={(e) => setToOrg(e.target.value)}
            />
          )}
        </Field>
      )}
      {creatingOrg && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="새 기관 이름" required>
            {(slot) => (
              <Input
                {...slot}
                value={newOrg.name}
                maxLength={ORG_NAME_MAX}
                autoFocus
                onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="유형" required>
            {(slot) => (
              <Select
                {...slot}
                value={newOrg.org_type}
                placeholder="유형 선택"
                options={TYPE_OPTIONS}
                onChange={(e) => setNewOrg({ ...newOrg, org_type: e.target.value as OrgType })}
              />
            )}
          </Field>
        </div>
      )}
      {text('title', '부서·직함')}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('phone', '전화', 'tel')}
        {text('email', '이메일', 'email')}
      </div>
      <Field label="메모">
        {(slot) => (
          <Textarea
            {...slot}
            rows={2}
            value={form.memo}
            maxLength={MEMO_MAX}
            onChange={(e) => set('memo')(e.target.value)}
          />
        )}
      </Field>
    </FormModal>
  )
}

const KIND_OPTIONS = ACTIVITY_KINDS.map((value) => ({ value, label: ACTIVITY_KIND_LABEL[value] }))

/**
 * 활동 기록 추가·수정. 미팅 직후 휴대폰으로 바로 적는 자리라(15 FR-CRM-23) 필수 칸은
 * 내용 하나다. 유형은 미팅, 일시는 지금, 사내 참석자는 나로 미리 채운다.
 */
export function ActivityFormModal({
  org,
  activity,
  dealId,
  onClose,
}: {
  org: OrgDetail
  activity?: Activity
  /** 안건 상세에서 열면 그 안건을 미리 골라 둔다. */
  dealId?: string
  onClose: () => void
}) {
  const me = useCurrentUser()
  const toast = useToast()
  const staff = useStaff()
  const save = useSaveActivity()
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? 'meeting')
  const [initialAt] = useState(() =>
    toDateTimeLocal(activity ? new Date(activity.occurred_at) : new Date()),
  )
  const [at, setAt] = useState(initialAt)
  const [contactIds, setContactIds] = useState(activity?.contacts.map((c) => c.id) ?? [])
  const [userIds, setUserIds] = useState(activity?.users.map((u) => u.id) ?? [me.id])
  const [body, setBody] = useState(activity?.body ?? '')
  const [deal, setDeal] = useState(activity?.deal?.id ?? dealId ?? '')
  const [error, setError] = useState<string | null>(null)
  const orgDeals = useDeals({ orgId: org.id })
  // 이 기관의 안건만 고른다. 끝난 안건도 뒷이야기를 적을 수 있게 남기되 상태를 붙인다.
  const dealOptions = [
    { value: '', label: '안건 없음' },
    ...(orgDeals.data?.items ?? []).map((d) => ({
      value: d.id,
      label: d.status === 'open' ? d.name : `${d.name} (${DEAL_STATUS_LABEL[d.status]})`,
    })),
  ]

  // 삭제 처리된 담당자는 새로 고를 수 없다. 이미 기록에 있던 사람은 칩으로 남겨 뺄 수 있게 한다.
  // 그사이 다른 기관으로 옮긴 참석자도 이 기관 명단에는 없으니 기록에서 가져와 붙인다.
  const contactOptions = [
    ...org.contacts
      .filter((c) => !c.erased || contactIds.includes(c.id))
      .map((c) => ({ id: c.id, name: contactName(c) })),
    ...(activity?.contacts
      .filter((c) => !org.contacts.some((o) => o.id === c.id))
      .map((c) => ({ id: c.id, name: contactName(c) })) ?? []),
  ]
  // 퇴사 등으로 명단에서 빠진 기존 참석자도 칩으로 남겨야 뺄 수 있다.
  const userOptions = [
    ...staff,
    ...(activity?.users.filter((u) => !staff.some((s) => s.id === u.id)) ?? []),
  ]

  const submit = () => {
    const when = new Date(at)
    if (Number.isNaN(when.getTime())) return setError('일시를 확인해 주세요.')
    setError(null)
    save.mutate(
      {
        id: activity?.id,
        org_id: org.id,
        deal_id: deal || null,
        kind,
        // 입력칸은 분까지만 담는다. 손대지 않았으면 원래 시각(초 포함)을 그대로 둔다.
        occurred_at: activity && at === initialAt ? activity.occurred_at : when.toISOString(),
        contact_ids: contactIds,
        user_ids: userIds,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          toast.success('기록했습니다.')
          onClose()
        },
        onError: (err) => setError(errorText(err, '기록하지 못했습니다.')),
      },
    )
  }

  return (
    <FormModal
      title={activity ? '활동 기록 수정' : '활동 기록'}
      description={org.name}
      busy={save.isPending}
      error={error}
      canSubmit={body.trim().length > 0 && at !== ''}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="유형" required>
          {(slot) => (
            <Select
              {...slot}
              value={kind}
              options={KIND_OPTIONS}
              onChange={(e) => setKind(e.target.value as ActivityKind)}
            />
          )}
        </Field>
        <Field label="일시" required>
          {(slot) => (
            <Input
              {...slot}
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="내용" required>
        {(slot) => (
          <Textarea
            {...slot}
            rows={4}
            value={body}
            maxLength={ACTIVITY_BODY_MAX}
            autoFocus
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      <Field label="안건">
        {(slot) => (
          <Select
            {...slot}
            value={deal}
            options={dealOptions}
            // 목록이 오기 전에는 고른 안건이 선택지에 없어 «안건 없음» 으로 보인다. 잠가 둔다.
            disabled={orgDeals.isPending}
            onChange={(e) => setDeal(e.target.value)}
          />
        )}
      </Field>
      <Field label="외부 참석자">
        {(slot) => (
          <ChipPicker
            slot={slot}
            label="외부 참석자"
            options={contactOptions}
            value={contactIds}
            onChange={setContactIds}
            empty="등록된 담당자가 없습니다."
          />
        )}
      </Field>
      <Field label="사내 참석자">
        {(slot) => (
          <ChipPicker
            slot={slot}
            label="사내 참석자"
            options={userOptions}
            value={userIds}
            onChange={setUserIds}
          />
        )}
      </Field>
    </FormModal>
  )
}

const DEAL_KIND_OPTIONS = DEAL_KINDS.map((value) => ({ value, label: DEAL_KIND_LABEL[value] }))

/** 억 원 입력칸 ↔ 원. 비우면 null(금액 미정). 소수 한 자리까지(1,234.5억). */
const toEokInput = (won: number | null) => (won === null ? '' : String(won / 1e8))
function fromEokInput(text: string): number | null | 'invalid' {
  if (!text.trim()) return null
  const eok = Number(text)
  return Number.isFinite(eok) && eok >= 0 ? Math.round(eok * 1e8) : 'invalid'
}

/**
 * 안건 등록·수정(15 §2.2). 등록하면 새 안건 상세로 간다.
 * 종류와 기관은 등록 때만 정한다. 단계 이름이 종류마다 달라서 종류를 바꾸면 단계가 뜻을 잃는다.
 */
export function DealFormModal({
  deal,
  kind: presetKind = 'fundraising',
  orgId: presetOrg = '',
  onClose,
}: {
  deal?: DealDetail
  kind?: DealKind
  orgId?: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const staff = useStaff()
  const me = useCurrentUser()
  const create = useCreateDeal()
  const update = useUpdateDeal()
  // 기관은 수십 곳이라 선택 상자로 충분하다. 등록 때만 쓴다.
  const orgs = useOrgs({ q: '', type: '', owner: '', staleDays: 0 }, !deal)
  // 연 순간의 version 을 끝까지 쓴다. 창이 열린 동안 캐시가 새로 읽혀 prop 이 바뀌어도
  // 옛 입력값에 새 version 을 붙여 남의 수정을 덮어쓰면 안 된다(15 NFR-CRM-02).
  const [baseVersion] = useState(deal?.version ?? 0)
  const [kind, setKind] = useState<DealKind>(deal?.kind ?? presetKind)
  const [name, setName] = useState(deal?.name ?? '')
  const [orgId, setOrgId] = useState(deal?.org.id ?? presetOrg)
  const [owner, setOwner] = useState(deal ? (deal.owner?.id ?? '') : me.id)
  const [amount, setAmount] = useState(toEokInput(deal?.amount_krw ?? null))
  const [target, setTarget] = useState(deal?.target_date ?? '')
  const [nextAction, setNextAction] = useState(deal?.next_action ?? '')
  const [nextDue, setNextDue] = useState(deal?.next_action_due ?? '')
  const [error, setError] = useState<string | null>(null)

  const ownerOptions = [
    { value: '', label: '지정 안 함' },
    ...staff.map((p) => ({ value: p.id, label: p.name })),
    // 퇴사한 기존 담당자도 목록에 남겨야 그대로 저장된다.
    ...(deal?.owner && !staff.some((p) => p.id === deal.owner?.id)
      ? [{ value: deal.owner.id, label: deal.owner.name }]
      : []),
  ]
  const orgOptions = (orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))

  const submit = () => {
    const won = fromEokInput(amount)
    if (won === 'invalid') return setError('금액은 0 이상의 숫자로 적어 주세요(억 원).')
    setError(null)
    const fields = {
      name: name.trim(),
      owner_id: owner || null,
      amount_krw: won,
      target_date: target || null,
      next_action: nextAction.trim(),
      next_action_due: nextDue || null,
    }
    const onError = (err: unknown) =>
      setError(
        err instanceof ApiError && err.status === 409
          ? '그사이 다른 사람이 이 안건을 고쳤습니다. 창을 닫고 다시 열어 새 내용에서 고쳐 주세요.'
          : errorText(err, '저장하지 못했습니다.'),
      )
    if (deal) {
      update.mutate(
        { id: deal.id, version: baseVersion, ...fields },
        {
          onSuccess: () => {
            toast.success('저장했습니다.')
            onClose()
          },
          onError,
        },
      )
      return
    }
    create.mutate(
      { kind, org_id: orgId, ...fields },
      {
        onSuccess: (made) => {
          toast.success('등록했습니다.')
          onClose()
          void navigate(`/crm/deals/${made.id}`)
        },
        onError,
      },
    )
  }

  return (
    <FormModal
      title={deal ? '안건 수정' : '안건 등록'}
      busy={create.isPending || update.isPending}
      error={error}
      canSubmit={name.trim().length > 0 && orgId !== ''}
      onClose={onClose}
      onSubmit={submit}
    >
      {!deal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="종류" required>
            {(slot) => (
              <Select
                {...slot}
                value={kind}
                options={DEAL_KIND_OPTIONS}
                onChange={(e) => setKind(e.target.value as DealKind)}
              />
            )}
          </Field>
          <Field label="상대 기관" required>
            {(slot) => (
              <Select
                {...slot}
                value={orgId}
                placeholder={orgs.isPending ? '불러오는 중' : '기관 선택'}
                options={orgOptions}
                onChange={(e) => setOrgId(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      <Field label="안건 이름" required>
        {(slot) => (
          <Input
            {...slot}
            value={name}
            maxLength={DEAL_NAME_MAX}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="사내 담당자">
          {(slot) => (
            <Select
              {...slot}
              value={owner}
              options={ownerOptions}
              onChange={(e) => setOwner(e.target.value)}
            />
          )}
        </Field>
        <Field label="금액(억 원)" hint="모르면 비워 둡니다.">
          {(slot) => (
            <Input
              {...slot}
              type="number"
              inputMode="decimal"
              min={0}
              // 0.1 로 두면 123.45억 같은 기존 금액이 브라우저 검증에 걸려 저장이 막힌다.
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="목표일">
        {(slot) => (
          <Input {...slot} type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="다음 할 일">
          {(slot) => (
            <Input {...slot} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
          )}
        </Field>
        <Field label="기한">
          {(slot) => (
            <Input
              {...slot}
              type="date"
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          )}
        </Field>
      </div>
    </FormModal>
  )
}
