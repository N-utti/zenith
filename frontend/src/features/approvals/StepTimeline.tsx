import { Check, Clock, Minus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/datetime'
import type { ApprovalStep, StepStatus } from './types'

const STATUS: Record<StepStatus, { label: string; icon: typeof Check; tone: string }> = {
  waiting: { label: '대기', icon: Clock, tone: 'bg-accent-soft text-accent' },
  approved: { label: '승인', icon: Check, tone: 'bg-success/12 text-success' },
  rejected: { label: '반려', icon: X, tone: 'bg-danger/12 text-danger' },
  delegated_done: { label: '대결', icon: Check, tone: 'bg-success/12 text-success' },
  // 문서가 끝나 더 받지 않은 단계. 전결로 끊긴 경우만이 아니라 반려·회수·강제 종결 뒤에도
  // 이 상태가 되므로 "전결 생략" 이라고 못 박지 않는다. 전결 처리 자체는 `delegated_done`(대결)이다.
  skipped: { label: '생략', icon: Minus, tone: 'bg-sunken text-subtle' },
}

/**
 * 결재선 타임라인(13 §10 SCR-APV-03). 단계마다 처리자·시각·의견을 시간순으로 보인다.
 * 위임 처리는 "박동현 (최재호 대결)"처럼 원 결재자를 그대로 두고 실제 처리자를 덧붙인다(13 §4.2.3).
 */
export function StepTimeline({
  steps,
  currentStep,
}: {
  steps: ApprovalStep[]
  currentStep: number | null
}) {
  if (steps.length === 0) {
    return (
      <p className="text-subtle text-sm">결재선이 없습니다. 기안과 동시에 확정된 문서입니다.</p>
    )
  }
  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const meta = STATUS[step.status]
        const Icon = meta.icon
        const isCurrent = step.step_no === currentStep
        return (
          <li key={step.step_no} className="flex gap-3">
            <span
              className={cn('grid size-7 shrink-0 place-items-center rounded-full', meta.tone)}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-fg text-sm">
                <span className="text-subtle mr-1.5 tabular-nums">{step.step_no}</span>
                {step.approver.name}
                {step.acted_by && step.acted_by.id !== step.approver.id && (
                  <span className="text-muted"> ({step.acted_by.name} 대결)</span>
                )}
                <span className={cn('ml-2 text-xs', isCurrent ? 'text-accent' : 'text-subtle')}>
                  {isCurrent ? '처리 중' : meta.label}
                </span>
              </p>
              {step.acted_at && (
                <p className="text-subtle text-xs">{formatDateTime(step.acted_at)}</p>
              )}
              {step.comment && <p className="text-muted mt-1 text-sm">{step.comment}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
