import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'
import { MOBILE_TABS } from '@/app/navigation'
import { useChannels } from '@/features/chat/api'
import { useUnreadNotificationCount } from '@/features/notifications/api'

/** 와이어프레임 3a의 하단 탭바. 데스크톱에서는 트리 사이드바가, 알림은 헤더 종이 이 역할을 한다. */
export function MobileTabBar() {
  // 사이드바 배지와 같은 채널 목록의 unread 합. 사이드바가 이미 받아 두고 소켓이 캐시를 바로
  // 고치므로 요청이 늘지 않는다(홈 한 벌을 구독하면 메시지마다 /me/home 을 다시 받는다).
  const unreadMessages = useChannels().data?.items.reduce((sum, c) => sum + c.unread, 0) ?? 0
  const unreadNotifications = useUnreadNotificationCount()

  return (
    <nav className="border-line bg-surface flex shrink-0 border-t pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      {MOBILE_TABS.map((tab) => {
        const Icon = tab.icon
        const unreadLabel =
          tab.to === '/chat' && unreadMessages > 0
            ? '안 읽은 메시지 있음'
            : tab.to === '/notifications' && unreadNotifications > 0
              ? '안 읽은 알림 있음'
              : null
        const showUnreadDot = unreadLabel !== null
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-1 transition-colors',
                isActive ? 'text-accent' : 'text-subtle',
              )
            }
          >
            <span className="relative">
              <Icon className="size-5.5" strokeWidth={2} />
              {showUnreadDot && (
                <span
                  className="bg-accent absolute -top-0.5 -right-0.5 block size-2 rounded-full"
                  aria-hidden
                />
              )}
            </span>
            <span className="text-[10px] font-medium">{tab.label}</span>
            {showUnreadDot && <span className="sr-only">, {unreadLabel}</span>}
          </NavLink>
        )
      })}
    </nav>
  )
}
