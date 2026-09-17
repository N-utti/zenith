import { useSearchParams } from 'react-router'
import { Link } from 'react-router'
import { Bell, FileText, Megaphone, MessagesSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/datetime'
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api'
import { notificationView, type NotificationView } from '@/features/notifications/view'
import type { Notification, NotificationFilter } from '@/features/notifications/types'

const FILTERS: NotificationFilter[] = ['all', 'unread']
const FILTER_LABEL: Record<NotificationFilter, string> = { all: '전체', unread: '안 읽음' }

const ICONS = { doc: FileText, chat: MessagesSquare, board: Megaphone }

/** 안 읽은 알림 앞의 점. 색만으로 구분하지 않도록 글에도 굵기를 준다. */
function UnreadDot({ unread }: { unread: boolean }) {
  return unread ? (
    <span className="bg-accent mt-2 size-2 shrink-0 rounded-full" aria-label="안 읽음" />
  ) : (
    <span className="mt-2 size-2 shrink-0" />
  )
}

function Row({
  notification,
  view,
  onOpen,
}: {
  notification: Notification
  view: NotificationView
  onOpen: () => void
}) {
  const Icon = ICONS[view.icon]
  const unread = notification.read_at === null

  const body = (
    <>
      <UnreadDot unread={unread} />
      <Avatar name={view.actorName} hue={200} size="sm" />
      <div className="min-w-0 flex-1">
        <p className={'text-fg text-[13px] leading-relaxed' + (unread ? ' font-semibold' : '')}>
          {view.summary}
        </p>
        {view.detail && <p className="text-muted mt-1 truncate text-[12px]">{view.detail}</p>}
        <p className="text-subtle mt-1 flex items-center gap-1 text-[11px]">
          <Icon className="size-3" />
          {formatRelative(notification.created_at)}
        </p>
      </div>
    </>
  )

  const shared = 'flex gap-3 px-4 py-3.5 text-left'

  // 권한 밖이라 제목이 가려진 알림은 열 수 없다. 누를 수 있게 두면 403 으로 보내는 셈이다.
  if (!view.to) {
    return <div className={shared + ' opacity-70'}>{body}</div>
  }

  return (
    <Link to={view.to} onClick={onOpen} className={shared + ' hover:bg-surface-hover transition-colors'}>
      {body}
    </Link>
  )
}

/** 알림함 (FR-SHL-04). 멘션·댓글·새 글이 한 곳에 모인다. */
export function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('filter') as NotificationFilter | null
  const filter: NotificationFilter = requested && FILTERS.includes(requested) ? requested : 'all'

  const { data, isPending, isError } = useNotifications(filter)
  const markRead = useMarkNotificationsRead()
  const toast = useToast()

  const items = data?.items ?? []
  const unreadIds = items.filter((n) => n.read_at === null).map((n) => n.id)

  const readAll = () =>
    markRead.mutate(unreadIds, {
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : '읽음 처리를 하지 못했습니다.'),
    })

  return (
    <>
      <PageHeader
        title="받은 알림"
        description="멘션·댓글·새 글을 한곳에서 봅니다. 누르면 그 자리로 갑니다."
        actions={
          unreadIds.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={readAll}
              disabled={markRead.isPending}
            >
              모두 읽음
            </Button>
          )
        }
      />

      <Tabs
        items={FILTERS.map((key) => ({ key, label: FILTER_LABEL[key] }))}
        value={filter}
        onChange={(key) =>
          setParams(
            (prev) => {
              if (key === 'all') prev.delete('filter')
              else prev.set('filter', key)
              return prev
            },
            { replace: true },
          )
        }
      >
        {() => (
          <Card>
            {isPending && <SkeletonRows />}
            {isError && <CardEmpty>알림을 불러오지 못했습니다.</CardEmpty>}

            {data &&
              (items.length === 0 ? (
                <CardEmpty>
                  {filter === 'unread' ? '안 읽은 알림이 없습니다.' : '받은 알림이 없습니다.'}
                </CardEmpty>
              ) : (
                <ul>
                  {items.map((notification, index) => {
                    // 모르는 종류는 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다.
                    const view = notificationView(notification)
                    if (!view) return null
                    return (
                      <li
                        key={notification.id}
                        className={index > 0 ? 'border-line border-t' : undefined}
                      >
                        <Row
                          notification={notification}
                          view={view}
                          onOpen={() => {
                            if (notification.read_at === null) markRead.mutate([notification.id])
                          }}
                        />
                      </li>
                    )
                  })}
                </ul>
              ))}
          </Card>
        )}
      </Tabs>

      {items.length === 0 && !isPending && !isError && (
        <p className="text-subtle mt-4 flex items-center justify-center gap-1.5 text-xs">
          <Bell className="size-3.5" />
          누군가 문서·채팅에서 회원님을 부르거나 새 글이 올라오면 여기에 쌓입니다.
        </p>
      )}
    </>
  )
}
