import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { formatISODate, toISODate } from '@/lib/datetime'
import { DEAL_STATUS_LABEL, type Deal, type DealStatus } from './types'

const STATUS_TONE: Record<DealStatus, 'accent' | 'success' | 'subtle'> = {
  open: 'accent',
  won: 'success',
  dropped: 'subtle',
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{DEAL_STATUS_LABEL[status]}</Badge>
}

/**
 * 다음 할 일 한 줄. 기한이 지났으면 빨갛게(15 FR-CRM-13 "기한이 지나면 보드 카드에 표시").
 * 끝난 안건은 할 일이 의미가 없어 그리지 않는다.
 */
export function NextAction({
  deal,
}: {
  deal: Pick<Deal, 'status' | 'next_action' | 'next_action_due'>
}) {
  if (deal.status !== 'open' || (!deal.next_action && !deal.next_action_due)) return null
  // 날짜끼리 비교한다. `YYYY-MM-DD` 는 문자열 순서가 곧 날짜 순서다. 오늘 기한은 아직 안 지났다.
  const overdue = deal.next_action_due !== null && deal.next_action_due < toISODate(new Date())
  // 간격은 gap 으로 준다. 기한이 다음 줄로 넘어가도 앞에 여백이 남지 않는다.
  return (
    <p className="text-muted flex flex-wrap gap-x-1.5 text-xs">
      {deal.next_action || '다음 할 일'}
      {deal.next_action_due && (
        <span
          className={cn(
            'inline-block whitespace-nowrap',
            overdue ? 'text-danger font-medium' : 'text-subtle',
          )}
        >
          {overdue ? '기한 지남 ' : ''}
          {formatISODate(deal.next_action_due)}
        </span>
      )}
    </p>
  )
}
