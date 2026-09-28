import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ActivityCard } from '@/features/crm/ActivityCard'
import { useDeal, useDropDeal, useOrg, useReopenDeal, useUpdateDeal } from '@/features/crm/api'
import { ActivityFormModal, DealFormModal } from '@/features/crm/CrmForms'
import { DealStatusBadge, NextAction } from '@/features/crm/DealBits'
import {
  DEAL_KIND_LABEL,
  DEAL_STAGES,
  formatEok,
  stageLabel,
  type Activity,
  type DealDetail,
  type DealEvent,
} from '@/features/crm/types'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatISOYearDate } from '@/lib/datetime'

type Dialog = { kind: 'edit' } | { kind: 'drop' } | { kind: 'activity'; activity?: Activity }

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

/** 이력 한 줄. 등록·이동·중단·재개. */
function eventText(deal: DealDetail, e: DealEvent) {
  if (e.action === 'drop') return `중단: ${e.reason ?? ''}`
  if (e.action === 'reopen') return '재개'
  if (e.from_stage === null) return `등록 (${stageLabel(deal.kind, e.to_stage)})`
  return `${stageLabel(deal.kind, e.from_stage)} → ${stageLabel(deal.kind, e.to_stage)}`
}

/** 안건 상세(15 §10). 단계·다음 할 일·단계 이력·활동 타임라인. */
export function CrmDealPage() {
  const { dealId = '' } = useParams()
  const toast = useToast()
  const deal = useDeal(dealId)
  // 활동 기록 창이 기관의 담당자·안건 목록을 쓴다. 기관 상세를 같이 받아 둔다.
  const org = useOrg(deal.data?.org.id ?? '')
  const move = useUpdateDeal()
  const reopen = useReopenDeal()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => setDialog(null)

  if (deal.isPending) return <SkeletonRows rows={4} />
  // 다시 불러오기가 실패해도 받은 데이터가 있으면 그대로 그린다(적던 활동 기록 보존).
  if (!deal.data) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted text-sm">
          {deal.error instanceof ApiError && deal.error.status === 404
            ? '없거나 삭제된 기관의 안건입니다.'
            : '안건을 불러오지 못했습니다.'}
        </p>
        <Link to="/crm" className="text-accent mt-4 inline-block text-sm hover:underline">
          안건 보드로
        </Link>
      </div>
    )
  }

  const d = deal.data
  const stages = DEAL_STAGES[d.kind]
  const last = stages.at(-1)?.key
  const open = d.status === 'open'

  const moveTo = (stage: string) => {
    if (stage === d.stage) return
    if (stage === last && !confirm(`${stages.at(-1)?.label}(으)로 옮기면 성사로 끝납니다.`)) return
    move.mutate(
      { id: d.id, version: d.version, stage },
      {
        onSuccess: () =>
          toast.success(stage === last ? '성사로 끝냈습니다.' : '단계를 옮겼습니다.'),
        onError: (err) => toast.error(errorText(err, '단계를 옮기지 못했습니다.')),
      },
    )
  }

  return (
    <>
      <Link
        to={d.kind === 'fundraising' ? '/crm' : `/crm?kind=${d.kind}`}
        className="text-subtle hover:text-fg mb-3 inline-block text-sm"
      >
        ← 안건 보드
      </Link>
      <PageHeader
        title={d.name}
        description={`${DEAL_KIND_LABEL[d.kind]} · ${d.org.name}`}
        actions={
          <>
            <DealStatusBadge status={d.status} />
            {open && (
              <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'drop' })}>
                중단
              </Button>
            )}
            {d.status === 'dropped' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={reopen.isPending}
                onClick={() =>
                  reopen.mutate(
                    { id: d.id, version: d.version },
                    {
                      onSuccess: () => toast.success('재개했습니다.'),
                      onError: (err) => toast.error(errorText(err, '재개하지 못했습니다.')),
                    },
                  )
                }
              >
                재개
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'edit' })}>
              수정
            </Button>
            <Button size="sm" disabled={!org.data} onClick={() => setDialog({ kind: 'activity' })}>
              <Plus className="size-4" />
              활동 기록
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4 lg:order-2">
          <Card>
            <CardHeader title="진행" />
            <dl className="space-y-3 px-5 pb-5 text-sm">
              <div>
                <dt className="text-subtle mb-1 text-xs">단계</dt>
                <dd>
                  {open ? (
                    <Select
                      aria-label="단계"
                      value={d.stage}
                      disabled={move.isPending}
                      options={stages.map((s) => ({ value: s.key, label: s.label }))}
                      onChange={(e) => moveTo(e.target.value)}
                    />
                  ) : (
                    <span className="text-fg">{stageLabel(d.kind, d.stage)}</span>
                  )}
                </dd>
              </div>
              {d.status === 'dropped' && d.drop_reason && (
                <div>
                  <dt className="text-subtle text-xs">중단 사유</dt>
                  <dd className="text-fg mt-0.5 whitespace-pre-wrap">{d.drop_reason}</dd>
                </div>
              )}
              <div>
                <dt className="text-subtle text-xs">상대 기관</dt>
                <dd className="mt-0.5">
                  <Link to={`/crm/orgs/${d.org.id}`} className="text-accent hover:underline">
                    {d.org.name}
                  </Link>
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-subtle text-xs">금액</dt>
                  <dd className="text-fg mt-0.5 tabular-nums">
                    {d.amount_krw === null ? '미정' : formatEok(d.amount_krw)}
                  </dd>
                </div>
                <div>
                  <dt className="text-subtle text-xs">목표일</dt>
                  <dd className="text-fg mt-0.5">
                    {d.target_date ? formatISOYearDate(d.target_date) : '미정'}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-subtle text-xs">사내 담당자</dt>
                <dd className="text-fg mt-0.5">{d.owner?.name ?? '지정 안 됨'}</dd>
              </div>
              {open && (d.next_action || d.next_action_due) && (
                <div>
                  <dt className="text-subtle text-xs">다음 할 일</dt>
                  <dd className="mt-0.5">
                    <NextAction deal={d} />
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="단계 이력" />
            <ol className="space-y-2 px-5 pb-5 text-sm">
              {d.events.map((e) => (
                <li key={e.id}>
                  <p className="text-fg">{eventText(d, e)}</p>
                  <p className="text-subtle text-xs">
                    {e.actor.name} · {formatDateTime(e.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <ActivityCard
          className="lg:order-1"
          target={{ dealId: d.id }}
          // 활동 창은 기관의 담당자·안건 목록이 있어야 뜬다. 그 전에는 눌러도 아무 일 없게 한다.
          onAdd={() => org.data && setDialog({ kind: 'activity' })}
          onEdit={(activity) => org.data && setDialog({ kind: 'activity', activity })}
        />
      </div>

      {dialog?.kind === 'edit' && <DealFormModal deal={d} onClose={close} />}
      {dialog?.kind === 'drop' && <DropDealModal deal={d} onClose={close} />}
      {dialog?.kind === 'activity' && org.data && (
        <ActivityFormModal
          org={org.data}
          activity={dialog.activity}
          dealId={d.id}
          onClose={close}
        />
      )}
    </>
  )
}

/** 중단. 사유 필수(15 FR-CRM-12). 나중에 재개하면 같은 안건으로 이어진다. */
function DropDealModal({ deal, onClose }: { deal: DealDetail; onClose: () => void }) {
  const toast = useToast()
  const drop = useDropDeal()
  const [baseVersion] = useState(deal.version)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open
      onClose={onClose}
      title="안건 중단"
      description="다시 진행하게 되면 재개할 수 있습니다. 활동 기록은 그대로 이어집니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!reason.trim() || drop.isPending}
            onClick={() => {
              setError(null)
              drop.mutate(
                { id: deal.id, version: baseVersion, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('중단했습니다.')
                    onClose()
                  },
                  onError: (err) => setError(errorText(err, '중단하지 못했습니다.')),
                },
              )
            }}
          >
            {drop.isPending ? <Spinner /> : '중단'}
          </Button>
        </>
      }
    >
      <Field label="중단 사유" required>
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
