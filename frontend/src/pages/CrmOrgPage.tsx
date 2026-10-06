import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Copy, Eraser, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { BackLink } from '@/components/ui/BackLink'
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
import {
  useDeals,
  useDeleteContact,
  useDeleteOrg,
  useEraseContact,
  useOrg,
} from '@/features/crm/api'
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
  REASON_MAX,
} from '@/features/crm/types'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/datetime'

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
  const removeContact = useDeleteContact()
  // 같은 줄의 개인정보 삭제와 지우기가 겹쳐 나가지 않게 둘을 같이 잠근다.
  const contactBusy = erase.isPending || removeContact.isPending
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
  // 개인정보를 지운 담당자는 줄로는 남기되 수에는 넣지 않는다(목록·내보내기와 같은 기준).
  const contactCount = o.contacts.filter((c) => !c.erased).length
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : '처리하지 못했습니다.')

  return (
    <>
      <BackLink to="/crm/orgs">기관 목록</BackLink>
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
              {contactCount > 0 && (
                <span className="text-subtle ml-1.5 font-normal">{contactCount}</span>
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
                      <div className="mt-1 flex items-center gap-1">
                        <a
                          href={`mailto:${c.email}`}
                          className="text-muted hover:text-accent flex items-center gap-1.5 break-all"
                        >
                          <Mail className="size-3.5 shrink-0" />
                          {c.email}
                        </a>
                        {/* 팀은 네이버 메일을 웹에서 쓴다. 메일 링크는 PC 메일 앱을 여니, 받는 사람 칸에 붙여 넣을 주소를 복사해 준다. */}
                        <button
                          type="button"
                          aria-label={`${c.email} 복사`}
                          title="주소 복사"
                          className={`${iconButton} -my-1 shrink-0`}
                          // http(IP) 로 열면 navigator.clipboard 가 없어 바로 던진다. 그것도 실패 토스트로 받는다.
                          onClick={() =>
                            Promise.resolve()
                              .then(() => navigator.clipboard.writeText(c.email))
                              .then(() => toast.success('메일 주소를 복사했습니다.'))
                              .catch(() =>
                                toast.error(
                                  '복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.',
                                ),
                              )
                          }
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    )}
                    {c.memo && <p className="text-subtle mt-1 whitespace-pre-wrap">{c.memo}</p>}
                    {/* 삭제된 담당자는 어디서 옮겨 왔는지도 드러내지 않는다. 경력도 그 사람의 정보다. */}
                    {!c.erased &&
                      c.moves.map((m) => (
                        <p key={`${m.from.id}-${m.moved_at}`} className="text-subtle mt-1 text-xs">
                          이전 소속{' '}
                          <Link
                            to={`/crm/orgs/${m.from.id}`}
                            className="hover:text-accent underline"
                          >
                            {m.from.name}
                          </Link>{' '}
                          ·{' '}
                          <time dateTime={m.moved_at} title={formatDateTime(m.moved_at)}>
                            {formatRelative(m.moved_at)}
                          </time>{' '}
                          이직
                        </p>
                      ))}
                  </div>
                  <div className="flex shrink-0 items-start">
                    {!c.erased && (
                      <button
                        type="button"
                        aria-label={`${c.name} 수정`}
                        className={iconButton}
                        onClick={() => setDialog({ kind: 'contact', contact: c })}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {!c.erased && isExec && (
                      <button
                        type="button"
                        aria-label={`${c.name} 개인정보 삭제`}
                        title="개인정보 삭제"
                        className={iconButton}
                        disabled={contactBusy}
                        onClick={() => {
                          if (
                            !confirm(
                              `${c.name} 님의 이름·연락처·메모를 지웁니다. 활동 기록에는 삭제된 담당자로 남습니다. 되돌릴 수 없습니다.`,
                            )
                          )
                            return
                          erase.mutate(c.id, {
                            onSuccess: () => toast.success('개인정보를 삭제했습니다.'),
                            onError,
                          })
                        }}
                      >
                        <Eraser className="size-3.5" />
                      </button>
                    )}
                    {/* 잘못 넣은 사람을 목록에서 치운다. 등록한 사람(활동 기록에 붙기 전)과 임원에게만
                        온다(서버가 판정한 값). 연락처를 비우는 개인정보 삭제와는 다른 일이다. */}
                    {c.can_delete && (
                      <button
                        type="button"
                        aria-label={`${contactName(c)} 지우기`}
                        title="목록에서 지우기"
                        className={iconButton}
                        disabled={contactBusy}
                        onClick={() => {
                          // 지워도 활동 기록에는 이름이 남는다. 이름까지 지우는 길(개인정보 삭제)은
                          // 임원에게만 있어서 그 안내는 임원에게만 낸다.
                          const message = c.erased
                            ? '개인정보를 지운 담당자를 목록에서 지웁니다. 활동 기록의 참석자 자리는 남습니다. 되돌릴 수 없습니다.'
                            : `${c.name} 님을 담당자 목록에서 지웁니다. 되돌릴 수 없습니다.` +
                              (isExec
                                ? ' 활동 기록에는 이름이 그대로 남습니다. 이름까지 지우려면 먼저 개인정보 삭제를 하세요.'
                                : '')
                          if (!confirm(message)) return
                          removeContact.mutate(c.id, {
                            onSuccess: () => toast.success('담당자를 지웠습니다.'),
                            onError,
                          })
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
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
          openDeals={deals.data?.items.filter((d) => d.status === 'open').length ?? 0}
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
  openDeals,
  onClose,
  onDeleted,
}: {
  id: string
  name: string
  /** 진행 중 안건이 있으면 서버가 409 로 막는다. 사유를 다 쓰기 전에 먼저 알린다. */
  openDeals: number
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
      description={
        openDeals
          ? `진행 중 안건 ${openDeals}건을 먼저 중단하거나 끝내야 ${name}을(를) 지울 수 있습니다.`
          : `${name}을(를) 목록에서 뺍니다. 사유는 감사 기록에 남습니다.`
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={openDeals > 0 || !reason.trim() || remove.isPending}
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
      {openDeals === 0 && (
        <Field label="삭제 사유" required>
          {(slot) => (
            <Textarea
              {...slot}
              rows={3}
              value={reason}
              maxLength={REASON_MAX}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      )}
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
    </Modal>
  )
}
