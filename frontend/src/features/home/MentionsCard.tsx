import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { hueOf } from '@/lib/avatar'
import { formatRelative } from '@/lib/datetime'
import { notificationView } from '@/features/notifications/view'
import { HomeSection } from './HomeSection'
import { useMentions } from './api'

/**
 * 나를 부른 곳. 홈 한 벌의 `mentions` 는 **알림 그대로**라(백엔드 `NotificationOut`)
 * 알림함과 같은 변환을 쓴다. 같은 사건을 두 가지 모양으로 그리지 않는다.
 */
export function MentionsCard() {
  const { data, isPending, isError, refetch } = useMentions()

  // 그릴 수 있는 것만 남긴다. 모르는 종류가 와도 빈 줄이 생기지 않는다.
  // 서버는 열 건까지 주지만 카드에는 세 줄만 둔다(12 UI 청사진).
  const rows = (data ?? [])
    .flatMap((notification) => {
      const view = notificationView(notification)
      return view?.to ? [{ notification, view }] : []
    })
    .slice(0, 3)

  return (
    <HomeSection title="나에게 온 멘션" to="/notifications">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && !data && <CardEmpty onRetry={refetch}>알림을 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (rows.length === 0 ? (
            <CardEmpty>새 멘션이 없습니다.</CardEmpty>
          ) : (
            <ul>
              {rows.map(({ notification, view }, index) => (
                <li key={notification.id}>
                  <Link
                    to={view.to ?? '/notifications'}
                    className={
                      'hover:bg-surface-hover flex gap-3 px-4 py-3.5 transition-colors' +
                      (index > 0 ? ' border-line border-t' : '')
                    }
                  >
                    <Avatar name={view.actorName} hue={hueOf(view.actorId)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-fg text-[13px] leading-relaxed">{view.summary}</p>
                      {view.detail && (
                        <p className="text-muted mt-0.5 truncate text-[12px]">{view.detail}</p>
                      )}
                      <p className="text-subtle mt-1 truncate text-[12px]">
                        {formatRelative(notification.created_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
