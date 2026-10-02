import { Link, useSearchParams } from 'react-router'
import { FileText, Lock, Megaphone, MessagesSquare, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { hueOf } from '@/lib/avatar'
import { formatRelative } from '@/lib/datetime'
import {
  useDeleteNotifications,
  useMarkNotificationsRead,
  useNotifications,
} from '@/features/notifications/api'
import { notificationView, type NotificationView } from '@/features/notifications/view'
import type { Notification, NotificationFilter } from '@/features/notifications/types'

const FILTERS: NotificationFilter[] = ['all', 'unread']
const FILTER_LABEL: Record<NotificationFilter, string> = { all: '전체', unread: '안 읽음' }

const ICONS = { doc: FileText, chat: MessagesSquare, board: Megaphone, locked: Lock }

/** 서버가 준 알림과 화면이 그릴 모양을 짝지은 것. 그릴 수 없는 알림은 애초에 여기 없다. */
interface Row {
  notification: Notification
  view: NotificationView
}

function NotificationRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const { notification, view } = row
  const Icon = ICONS[view.icon]
  const unread = notification.read_at === null

  const body = (
    <>
      {/* 색만으로 구분하지 않는다. 글자 굵기로도 갈리고, 낭독기에는 숨김 텍스트로 알린다. */}
      <span className="mt-2 size-2 shrink-0">
        {unread && (
          <>
            <span className="bg-accent block size-2 rounded-full" aria-hidden />
            <span className="sr-only">안 읽음</span>
          </>
        )}
      </span>

      {/* 가려진 알림에는 글쓴이를 남기지 않는다. 아바타 이니셜도 누군지 알려 주는 단서다. */}
      {view.masked ? (
        <span className="bg-sunken text-subtle grid size-7 shrink-0 place-items-center rounded-full">
          <Lock className="size-3.5" />
        </span>
      ) : (
        <Avatar name={view.actorName} hue={hueOf(view.actorId)} size="sm" />
      )}

      <div className="min-w-0 flex-1">
        <p className={'text-fg text-[13px] leading-relaxed' + (unread ? ' font-semibold' : '')}>
          {view.summary}
        </p>
        {view.detail && <p className="text-muted mt-1 truncate text-[12px]">{view.detail}</p>}
        <p className="text-subtle mt-1 flex items-center gap-1 text-[11px]">
          <Icon className="size-3" />
          {view.masked ? '열람 권한이 없습니다' : formatRelative(notification.created_at)}
        </p>
      </div>
    </>
  )

  // 오른쪽 여백은 줄 끝에 뜨는 지우기 버튼의 자리다. 글이 그 밑으로 들어가지 않게 한다.
  const shared = 'flex gap-3 py-3.5 pr-11 pl-4 text-left'

  // 권한 밖이라 제목이 가려진 알림은 열 수 없다. 누를 수 있게 두면 403 으로 보내는 셈이다.
  if (!view.to) return <div className={shared}>{body}</div>

  return (
    <Link
      to={view.to}
      onClick={onOpen}
      className={`${shared} hover:bg-surface-hover transition-colors`}
    >
      {body}
    </Link>
  )
}

/** 알림함(`/notifications`). 멘션·댓글·새 글이 한 곳에 모인다. */
export function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('filter') as NotificationFilter | null
  const filter: NotificationFilter = requested && FILTERS.includes(requested) ? requested : 'all'

  const { data, isPending, isError, isFetching } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const remove = useDeleteNotifications()
  const toast = useToast()

  /*
   * 그릴 수 있는 알림만 남긴다. 빈 상태·구분선·안 읽음 개수를 전부 이 배열로 판정해야 한다.
   * 서버가 준 개수로 판정하면, 받은 알림이 전부 모르는 종류일 때 목록은 비었는데 빈 상태
   * 문구는 안 나오고 "모두 읽음" 버튼만 떠 있는 빈 카드가 된다.
   */
  const rows: Row[] = (data?.items ?? []).flatMap((notification) => {
    const view = notificationView(notification)
    return view ? [{ notification, view }] : []
  })
  const shown = filter === 'unread' ? rows.filter((r) => r.notification.read_at === null) : rows
  const unreadIds = rows
    .filter((r) => r.notification.read_at === null)
    .map((r) => r.notification.id)

  // 읽은 것만 한꺼번에 지운다. 안 읽은 알림은 아직 못 본 부름이라 묶어서 지우지 않는다(줄의
  // 버튼으로 하나씩은 지울 수 있다). 그릴 수 없는 종류의 알림은 화면에 없으니 건드리지 않는다.
  const readIds = rows.filter((r) => r.notification.read_at !== null).map((r) => r.notification.id)

  const removeIds = (ids: string[]) => {
    if (ids.length === 0) return
    remove.mutate(ids, {
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : '알림을 지우지 못했습니다.'),
    })
  }

  const readAll = () => {
    if (unreadIds.length === 0) return
    markRead.mutate(unreadIds, {
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : '읽음 처리를 하지 못했습니다.'),
    })
  }

  return (
    <>
      <PageHeader
        title="받은 알림"
        description="멘션·댓글·새 글을 한곳에서 봅니다. 누르면 그 자리로 갑니다."
        actions={
          <>
            {readIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removeIds(readIds)}
                // 아래 「모두 읽음」과 같은 이유로, 목록을 다시 받는 동안에도 막는다.
                disabled={remove.isPending || isFetching}
              >
                읽은 알림 지우기
              </Button>
            )}
            {unreadIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={readAll}
                // 목록을 다시 받아오는 동안에도 막는다. 그 사이 `unreadIds` 는 옛 값이라
                // 연타하면 이미 읽은 것을 그대로 다시 보낸다.
                disabled={markRead.isPending || isFetching}
              >
                모두 읽음
              </Button>
            )}
          </>
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
              (shown.length === 0 ? (
                <CardEmpty>
                  {filter === 'unread'
                    ? '안 읽은 알림이 없습니다.'
                    : '받은 알림이 없습니다. 누군가 문서·채팅에서 회원님을 부르거나 새 글이 올라오면 여기에 쌓입니다.'}
                </CardEmpty>
              ) : (
                <ul>
                  {shown.map((row, index) => (
                    <li
                      key={row.notification.id}
                      className={cn('group/notice relative', index > 0 && 'border-line border-t')}
                    >
                      <NotificationRow
                        row={row}
                        onOpen={() => {
                          // 화면을 옮기면서 부르므로 실패해도 알릴 자리가 없다. 다음에 다시
                          // 들어오면 안 읽음으로 남아 있어서 한 번 더 누를 수 있다.
                          if (row.notification.read_at === null) {
                            markRead.mutate([row.notification.id])
                          }
                        }}
                      />
                      {/* 지우기는 줄의 링크 밖에, 그 뒤에 둔다. 링크 안의 버튼은 누르면 그 자리로 가
                          버리고, 앞에 두면 Tab 이 알림보다 지우기에 먼저 닿는다.
                          줄에 올리거나 Tab 으로 닿을 때만 보이고 손가락 기기에서는 늘 보인다.
                          숨어 있을 때는 눌리지도 않는다(할 일 카드·댓글 줄과 같은 규약). */}
                      <button
                        type="button"
                        aria-label={`${row.view.summary} 알림 지우기`}
                        title="알림 지우기"
                        disabled={remove.isPending}
                        onClick={() => removeIds([row.notification.id])}
                        className="text-subtle hover:text-danger pointer-events-none absolute top-3 right-3 grid size-6 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-focus-within/notice:pointer-events-auto group-focus-within/notice:opacity-100 group-hover/notice:pointer-events-auto group-hover/notice:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </Card>
        )}
      </Tabs>
    </>
  )
}
