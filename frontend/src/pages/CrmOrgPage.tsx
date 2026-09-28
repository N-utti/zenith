import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ActivityCard, iconButton } from '@/features/crm/ActivityCard'
import { useDeals, useDeleteOrg, useEraseContact, useOrg } from '@/features/crm/api'
import {
  ActivityFormModal,
  ContactFormModal,
  DealFormModal,
  OrgFormModal,
} from '@/features/crm/CrmForms'
import { DealStatusBadge, NextAction } from '@/features/crm/DealBits'
import {
  DEAL_KIND_LABEL,
  ORG_TYPE_LABEL,
  contactName,
  formatEok,
  stageLabel,
  type Activity,
  type Contact,
} from '@/features/crm/types'
import { ApiError } from '@/lib/api'

/** 열려 있는 창. 한 번에 하나만 뜬다. */
type Dialog =
  | { kind: 'org' }
  | { kind: 'delete' }
  | { kind: 'contact'; contact?: Contact }
  | { kind: 'activity'; activity?: Activity }
  | { kind: 'deal' }

/** 기관 상세(15 CRM 모듈 설계서 §10). 담당자와 활동 타임라인을 한 화면에 둔다. */
export function CrmOrgPage() {
  const { orgId = '' } = useParams()
  const me = useCurrentUser()
  const navigate = useNavigate()
  const toast = useToast()
  const org = useOrg(orgId)
  const deals = useDeals({ orgId })
  const erase = useEraseContact()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => setDialog(null)
  // 화면 편의일 뿐이다. 삭제·개인정보 삭제의 실제 차단은 서버 403 이다(15 §3).
  const isExec = me.role === 'exec'

  if (org.isPending) return <SkeletonRows rows={4} />
  // 다시 불러오기가 실패해도 이미 받은 데이터가 있으면 그대로 그린다. 에러 화면으로 바꾸면
  // 열려 있던 활동 기록 창과 적던 내용이 같이 사라진다.
  if (!org.data) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted text-sm">
          {org.error instanceof ApiError && org.error.status === 404
            ? '없거나 삭제된 기관입니다.'
            : '기관을 불러오지 못했습니다.'}
        </p>
        <Link to="/crm/orgs" className="text-accent mt-4 inline-block text-sm hover:underline">
          기관 목록으로
        </Link>
      </div>
    )
  }

  const o = org.data
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : '처리하지 못했습니다.')

  return (
    <>
      <Link to="/crm/orgs" className="text-subtle hover:text-fg mb-3 inline-block text-sm">
        ← 기관 목록
      </Link>
      <PageHeader
        title={o.name}
        description={ORG_TYPE_LABEL[o.org_type]}
        actions={
          <>
            {isExec && (
              <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'delete' })}>
                삭제
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'org' })}>
              수정
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'activity' })}>
              <Plus className="size-4" />
              활동 기록
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="lg:order-2">
          <CardHeader title="기본 정보" />
          <dl className="space-y-3 px-5 pb-5 text-sm">
            <div>
              <dt className="text-subtle text-xs">사내 창구</dt>
              <dd className="text-fg mt-0.5">
                {o.owners.map((p) => p.name).join(', ') || '지정 안 됨'}
              </dd>
            </div>
            {o.memo && (
              <div>
                <dt className="text-subtle text-xs">메모</dt>
                <dd className="text-fg mt-0.5 whitespace-pre-wrap">{o.memo}</dd>
              </div>
            )}
          </dl>

          <div className="border-line flex items-center justify-between border-t px-5 pt-4 pb-2">
            <h2 className="text-fg text-sm font-semibold">
              담당자
              {o.contacts.length > 0 && (
                <span className="text-subtle ml-1.5 font-normal">{o.contacts.length}</span>
              )}
            </h2>
            <button
              type="button"
              aria-label="담당자 추가"
              className={iconButton}
              onClick={() => setDialog({ kind: 'contact' })}
            >
              <Plus className="size-4" />
            </button>
          </div>
          {o.contacts.length === 0 ? (
            <CardEmpty>등록된 담당자가 없습니다.</CardEmpty>
          ) : (
            <ul className="px-5 pb-4">
              {o.contacts.map((c) => (
                <li key={c.id} className="border-line flex gap-2 border-b py-3 last:border-b-0">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className={c.erased ? 'text-subtle' : 'text-fg font-medium'}>
                      {contactName(c)}
                      {c.title && <span className="text-muted ml-1.5 font-normal">{c.title}</span>}
                    </p>
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="text-muted hover:text-accent mt-1 flex items-center gap-1.5"
                      >
                        <Phone className="size-3.5" />
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-muted hover:text-accent mt-1 flex items-center gap-1.5 break-all"
                      >
                        <Mail className="size-3.5 shrink-0" />
                        {c.email}
                      </a>
                    )}
                    {c.memo && <p className="text-subtle mt-1 whitespace-pre-wrap">{c.memo}</p>}
                  </div>
                  {!c.erased && (
                    <div className="flex shrink-0 items-start">
                      <button
                        type="button"
                        aria-label={`${c.name} 수정`}
                        className={iconButton}
                        onClick={() => setDialog({ kind: 'contact', contact: c })}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {isExec && (
                        <button
                          type="button"
                          aria-label={`${c.name} 개인정보 삭제`}
                          title="개인정보 삭제"
                          className={iconButton}
                          disabled={erase.isPending}
                          onClick={() => {
                            if (
                              !confirm(
                                `${c.name} 님의 이름·연락처·메모를 지웁니다. 활동 기록에는 «삭제된 담당자» 로 남습니다. 되돌릴 수 없습니다.`,
                              )
                            )
                              return
                            erase.mutate(c.id, {
                              onSuccess: () => toast.success('개인정보를 삭제했습니다.'),
                              onError,
                            })
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4 lg:order-1">
          <Card>
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-fg text-sm font-semibold">
                안건
                {(deals.data?.items.length ?? 0) > 0 && (
                  <span className="text-subtle ml-1.5 font-normal">{deals.data?.items.length}</span>
                )}
              </h2>
              <button
                type="button"
                aria-label="안건 등록"
                className={iconButton}
                onClick={() => setDialog({ kind: 'deal' })}
              >
                <Plus className="size-4" />
              </button>
            </div>
            {deals.isPending && <SkeletonRows rows={2} />}
            {deals.isError && !deals.data && (
              <CardEmpty onRetry={deals.refetch}>안건을 불러오지 못했습니다.</CardEmpty>
            )}
            {deals.data?.items.length === 0 && (
              <CardEmpty>이 기관과 걸린 안건이 없습니다.</CardEmpty>
            )}
            {deals.data && deals.data.items.length > 0 && (
              <ul className="px-5 pb-4">
                {deals.data.items.map((d) => (
                  <li key={d.id} className="border-line space-y-1 border-b py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        to={`/crm/deals/${d.id}`}
                        className="text-fg hover:text-accent text-sm font-medium hover:underline"
                      >
                        {d.name}
                      </Link>
                      <DealStatusBadge status={d.status} />
                    </div>
                    <p className="text-subtle text-xs">
                      {DEAL_KIND_LABEL[d.kind]} · {stageLabel(d.kind, d.stage)}
                      {d.amount_krw !== null && ` · ${formatEok(d.amount_krw)}`}
                    </p>
                    <NextAction deal={d} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ActivityCard
            target={{ orgId: o.id }}
            onAdd={() => setDialog({ kind: 'activity' })}
            onEdit={(activity) => setDialog({ kind: 'activity', activity })}
          />
        </div>
      </div>

      {dialog?.kind === 'org' && <OrgFormModal org={o} onClose={close} />}
      {dialog?.kind === 'contact' && (
        <ContactFormModal orgId={o.id} contact={dialog.contact} onClose={close} />
      )}
      {dialog?.kind === 'activity' && (
        <ActivityFormModal org={o} activity={dialog.activity} onClose={close} />
      )}
      {dialog?.kind === 'deal' && <DealFormModal orgId={o.id} onClose={close} />}
      {dialog?.kind === 'delete' && (
        <DeleteOrgModal
          id={o.id}
          name={o.name}
          onClose={close}
          onDeleted={() => void navigate('/crm/orgs', { replace: true })}
        />
      )}
    </>
  )
}

/** 기관 삭제. 임원만, 사유 필수(15 §3). 목록에서만 빠지고 기록은 남는다. */
function DeleteOrgModal({
  id,
  name,
  onClose,
  onDeleted,
}: {
  id: string
  name: string
  onClose: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const remove = useDeleteOrg()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open
      onClose={onClose}
      title="기관 삭제"
      description={`${name}을(를) 목록에서 뺍니다. 사유는 감사 기록에 남습니다.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!reason.trim() || remove.isPending}
            onClick={() => {
              setError(null)
              remove.mutate(
                { id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('삭제했습니다.')
                    onDeleted()
                  },
                  onError: (err) =>
                    setError(err instanceof ApiError ? err.message : '삭제하지 못했습니다.'),
                },
              )
            }}
          >
            {remove.isPending ? <Spinner /> : '삭제'}
          </Button>
        </>
      }
    >
      <Field label="삭제 사유" required>
        {(slot) => (
          <Textarea
            {...slot}
            rows={3}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
    </Modal>
  )
}
