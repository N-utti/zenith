import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import {
  useApproval,
  useApproveStep,
  useCancelApproval,
  useForceCloseApproval,
  useRejectStep,
  useSubmitApproval,
} from '@/features/approvals/api'
import { StepTimeline } from '@/features/approvals/StepTimeline'
import { APPROVAL_TYPE_LABEL, statusLabel, statusTone } from '@/features/approvals/types'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/datetime'
import { ROLE_RANK } from '@/types'

const won = new Intl.NumberFormat('ko-KR')

/** 사유를 받아야 끝나는 두 동작. 문구만 다르고 폼은 같다. */
const REASON_FORM = {
  reject: {
    title: '반려',
    description: '사유는 기안자에게 그대로 전달됩니다.',
    label: '반려 사유',
    submit: '반려',
  },
  force: {
    title: '강제 종결',
    description: '결재를 더 받지 않고 문서를 끝냅니다. 사유는 기록에 남습니다.',
    label: '종결 사유',
    submit: '강제 종결',
  },
}

/** 문서 상세(13 SCR-APV-03). 본문 + 결재선 타임라인 + 내 차례면 승인/반려, 기안자면 상신/회수. */
export function ApprovalDetailPage() {
  const { approvalId = '' } = useParams()
  const user = useCurrentUser()
  const navigate = useNavigate()
  const doc = useApproval(approvalId)
  const toast = useToast()
  const submit = useSubmitApproval()
  const cancel = useCancelApproval()
  const approve = useApproveStep()
  const reject = useRejectStep()
  const forceClose = useForceCloseApproval()
  /** 열려 있는 사유 입력창. 반려와 강제 종결이 같은 폼을 쓴다. */
  const [asking, setAsking] = useState<'reject' | 'force' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (doc.isPending) return <SkeletonRows rows={4} />
  if (doc.isError || !doc.data) {
    const message =
      doc.error instanceof ApiError && doc.error.status === 403
        ? '열람 권한이 없습니다. 기안자 · 결재선에 오른 사람 · 임원만 볼 수 있습니다.'
        : '문서를 불러오지 못했습니다.'
    return (
      <div className="py-16 text-center">
        <p className="text-muted text-sm">{message}</p>
        <Link to="/approvals" className="text-accent mt-4 inline-block text-sm hover:underline">
          결재함으로
        </Link>
      </div>
    )
  }

  const d = doc.data
  const current = d.steps.find((s) => s.step_no === d.current_step)
  const myTurn = d.status === 'pending' && current?.approver.id === user.id
  const isDrafter = d.drafter.id === user.id
  // 임원은 남의 문서도 끝낼 수 있다. 결재자가 자리를 비워 영영 대기로 남는 문서를 끊는 길이다.
  const canForceClose = d.status === 'pending' && ROLE_RANK[user.role] >= ROLE_RANK.exec
  const busy =
    submit.isPending ||
    cancel.isPending ||
    approve.isPending ||
    reject.isPending ||
    forceClose.isPending
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : '처리하지 못했습니다.')

  const closeForm = () => {
    // 보내는 중에 닫으면 성공·실패를 받을 곳이 사라진다.
    if (reject.isPending || forceClose.isPending) return
    setAsking(null)
    setReason('')
    setError(null)
  }

  const done = (message: string) => () => {
    setAsking(null)
    setReason('')
    toast.success(message)
  }

  const failed = (fallback: string) => (err: unknown) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const submitReason = () => {
    const text = reason.trim()
    if (!text) return
    setError(null)
    if (asking === 'force') {
      forceClose.mutate(
        { id: d.id, reason: text },
        { onSuccess: done('강제 종결했습니다.'), onError: failed('종결하지 못했습니다.') },
      )
      return
    }
    if (!current) return
    reject.mutate(
      { id: d.id, version: current.version, reason: text },
      { onSuccess: done('반려했습니다.'), onError: failed('반려하지 못했습니다.') },
    )
  }

  return (
    <>
      <Link to="/approvals" className="text-subtle hover:text-fg mb-3 inline-block text-sm">
        ← 결재함
      </Link>
      <PageHeader
        title={d.title}
        description={`${APPROVAL_TYPE_LABEL[d.type_code]} · ${d.drafter.name} 기안 · ${formatDateTime(d.submitted_at ?? d.created_at)}`}
        actions={
          <>
            <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
            {isDrafter && d.status === 'draft' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void navigate(`/approvals/new?draft=${d.id}`)}
                >
                  이어쓰기
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    submit.mutate(d.id, {
                      onSuccess: () => toast.success('상신했습니다.'),
                      onError,
                    })
                  }
                >
                  {submit.isPending ? <Spinner className="border-t-on-accent" /> : '상신'}
                </Button>
              </>
            )}
            {isDrafter && d.status === 'pending' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!confirm('이 문서를 회수할까요? 결재자의 결재함에서 사라집니다.')) return
                  cancel.mutate(d.id, { onSuccess: () => toast.success('회수했습니다.'), onError })
                }}
              >
                회수
              </Button>
            )}
            {myTurn && current && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setAsking('reject')}
                >
                  반려
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    approve.mutate(
                      { id: d.id, version: current.version },
                      { onSuccess: () => toast.success('승인했습니다.'), onError },
                    )
                  }
                >
                  {approve.isPending ? <Spinner className="border-t-on-accent" /> : '승인'}
                </Button>
              </>
            )}
            {canForceClose && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking('force')}>
                강제 종결
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="본문" />
          <div className="space-y-4 px-5 pb-5">
            {d.amount !== null && (
              <p className="text-fg text-lg font-semibold tabular-nums">
                {won.format(d.amount)}
                <span className="text-subtle ml-0.5 text-sm font-normal">원</span>
              </p>
            )}
            {d.related && (
              <p className="text-muted text-sm">
                관련 문서: 출장 신청.{' '}
                <Link to="/attendance?tab=exception" className="text-accent hover:underline">
                  예외 근무 탭에서 보기
                </Link>
              </p>
            )}
            <p className="text-fg text-sm whitespace-pre-wrap">{d.subject.body || '(본문 없음)'}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="결재선" />
          <div className="px-5 pb-5">
            <StepTimeline steps={d.steps} currentStep={d.current_step} />
          </div>
        </Card>
      </div>

      {asking && (
        <Modal
          open
          onClose={closeForm}
          title={REASON_FORM[asking].title}
          description={REASON_FORM[asking].description}
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={closeForm} disabled={busy}>
                취소
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={reason.trim().length === 0 || busy}
                onClick={submitReason}
              >
                {busy ? <Spinner /> : REASON_FORM[asking].submit}
              </Button>
            </>
          }
        >
          <Field label={REASON_FORM[asking].label} required>
            {(slot) => (
              <Textarea
                {...slot}
                rows={4}
                value={reason}
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
      )}
    </>
  )
}
