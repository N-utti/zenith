import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'
import { MOBILE_TABS } from '@/app/navigation'

/** 와이어프레임 3a의 하단 탭바. 데스크톱에서는 트리 사이드바가 이 역할을 한다. */
export function MobileTabBar() {
  return (
    <nav className="border-line bg-surface flex shrink-0 border-t pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      {MOBILE_TABS.map((tab) => {
        const Icon = tab.icon
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
            <Icon className="size-5.5" strokeWidth={2} />
            <span className="text-[10px] font-medium">{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
