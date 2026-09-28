import { Link } from 'react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/datetime'
import { useActivities, useDeleteActivity } from './api'
import { ACTIVITY_KIND_LABEL, contactName, type Activity } from './types'

export const iconButton =
  'text-subtle hover:bg-surface-hover hover:text-fg grid size-8 cursor-pointer place-items-center rounded-lg transition-colors'

/**
 * 활동 타임라인. 기관 상세와 안건 상세가 같이 쓴다(15 §4.2.2: 한 기록이 양쪽에 뜬다).
 * 기관 쪽에서는 어느 안건 기록인지, 안건 쪽에서는 어느 기관인지가 다른 줄이다.
 */
export function ActivityCard({
  target,
  className,
  onAdd,
  onEdit,
}: {
  target: { orgId: string } | { dealId: string }
  className?: string
  onAdd: () => void
  onEdit: (activity: Activity) => void
}) {
  const toast = useToast()
  const activities = useActivities(target)
  const remove = useDeleteActivity()
  const onOrgPage = 'orgId' in target

  return (
    <Card className={className}>
      <CardHeader title="활동" />
      {activities.isPending && <SkeletonRows rows={3} />}
      {activities.isError && !activities.data && (
        <CardEmpty onRetry={activities.refetch}>활동 기록을 불러오지 못했습니다.</CardEmpty>
      )}
      {activities.data?.items.length === 0 && (
        <CardEmpty
          action={
            <Button size="sm" onClick={onAdd}>
              첫 활동 기록
            </Button>
          }
        >
          아직 기록이 없습니다.
        </CardEmpty>
      )}
      {activities.data && activities.data.items.length > 0 && (
        <ol className="px-5 pb-4">
          {activities.data.items.map((a) => (
            <li key={a.id} className="border-line border-b py-3 last:border-b-0">
              {/* 좁은 폭에서는 줄을 바꾸되 날짜·이름 한가운데서 쪼개지지 않게 덩어리마다 nowrap. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <Badge tone="accent">{ACTIVITY_KIND_LABEL[a.kind]}</Badge>
                <time dateTime={a.occurred_at} className="text-muted whitespace-nowrap">
                  {formatDateTime(a.occurred_at)}
                </time>
                <span className="text-subtle whitespace-nowrap">· {a.author.name}</span>
                {a.can_edit && (
                  <span className="ml-auto flex">
                    <button
                      type="button"
                      aria-label={`${formatDateTime(a.occurred_at)} 활동 기록 수정`}
                      className={iconButton}
                      onClick={() => onEdit(a)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${formatDateTime(a.occurred_at)} 활동 기록 삭제`}
                      className={iconButton}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (!confirm('이 활동 기록을 지울까요?')) return
                        remove.mutate(a.id, {
                          onSuccess: () => toast.success('지웠습니다.'),
                          onError: (err) =>
                            toast.error(
                              err instanceof ApiError ? err.message : '처리하지 못했습니다.',
                            ),
                        })
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {onOrgPage && a.deal && (
                <Link
                  to={`/crm/deals/${a.deal.id}`}
                  className="text-accent mt-1.5 inline-block text-xs hover:underline"
                >
                  {a.deal.name}
                </Link>
              )}
              {!onOrgPage && a.org && (
                <Link
                  to={`/crm/orgs/${a.org.id}`}
                  className="text-accent mt-1.5 inline-block text-xs hover:underline"
                >
                  {a.org.name}
                </Link>
              )}
              <p className="text-fg mt-1.5 text-sm whitespace-pre-wrap">{a.body}</p>
              {(a.contacts.length > 0 || a.users.length > 0) && (
                <p className="text-subtle mt-1.5 text-xs">
                  참석: {[...a.contacts.map(contactName), ...a.users.map((u) => u.name)].join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
