import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api'
import { NotificationRow } from '@/features/notifications/NotificationRow'
import { toRows } from '@/features/notifications/view'

/**
 * 헤더의 알림 종과 드롭다운. 알림함(`/notifications`)과 같은 목록 캐시를 읽어 요청이 늘지 않는다.
 * 지우기는 알림함에만 둔다. 여기는 훑어보고 그 자리로 가는 곳이다.
 *
 * 폰에서는 숨긴다. 하단 탭바에 알림 탭이 이미 있다.
 */
export function NotificationMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const { data, isPending, isError, isFetching } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const toast = useToast()

  const rows = toRows(data?.items ?? [])
  const unreadIds = rows
    .filter((r) => r.notification.read_at === null)
    .map((r) => r.notification.id)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 안에 초점이 있던 채로 닫으면 초점이 페이지 맨 앞으로 떨어진다. 종으로 돌려준다.
      if (ref.current?.contains(document.activeElement)) bellRef.current?.focus()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative hidden md:block">
      <Button
        ref={bellRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadIds.length > 0 ? `알림, ${unreadIds.length}개 안 읽음` : '알림'}
        title="알림"
        className="relative px-2"
      >
        <Bell className="size-4.5" />
        {unreadIds.length > 0 && (
          <span
            className="bg-accent text-on-accent absolute -top-0.5 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold"
            aria-hidden
          >
            {unreadIds.length > 9 ? '9+' : unreadIds.length}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="알림"
          className="border-line bg-surface absolute right-0 z-40 mt-2 flex max-h-[min(560px,calc(100dvh-80px))] w-[380px] flex-col rounded-xl border shadow-lg"
        >
          <div className="border-line flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-fg text-sm font-semibold">알림</p>
            {unreadIds.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  markRead.mutate(unreadIds, {
                    onError: (err) =>
                      toast.error(
                        err instanceof ApiError ? err.message : '읽음 처리를 하지 못했습니다.',
                      ),
                  })
                }
                // 알림함과 같은 이유로 다시 받는 동안에도 막는다. 그 사이 `unreadIds` 는 옛 값이다.
                disabled={markRead.isPending || isFetching}
                className="text-muted hover:text-fg cursor-pointer text-xs disabled:cursor-default disabled:opacity-50"
              >
                모두 읽음
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isPending && <p className="text-subtle px-4 py-8 text-center text-sm">불러오는 중…</p>}
            {isError && (
              <p className="text-subtle px-4 py-8 text-center text-sm">
                알림을 불러오지 못했습니다.
              </p>
            )}
            {data && !isError && rows.length === 0 && (
              <p className="text-subtle px-4 py-8 text-center text-sm">받은 알림이 없습니다.</p>
            )}
            {rows.length > 0 && (
              <ul>
                {rows.map((row, index) => (
                  <li key={row.notification.id} className={cn(index > 0 && 'border-line border-t')}>
                    <NotificationRow
                      row={row}
                      className="px-4 py-3"
                      onOpen={() => {
                        setOpen(false)
                        // 화면을 옮기면서 부르므로 실패해도 알릴 자리가 없다(알림함과 같다).
                        if (row.notification.read_at === null) {
                          markRead.mutate([row.notification.id])
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="border-line text-muted hover:bg-surface-hover hover:text-fg block rounded-b-xl border-t px-4 py-2.5 text-center text-[13px] transition-colors"
          >
            모든 알림 보기
          </Link>
        </div>
      )}
    </div>
  )
}
