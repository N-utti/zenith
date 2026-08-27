import { NavLink } from 'react-router'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from '@/app/navigation'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_RANK } from '@/types'
import { Button } from '@/components/ui/Button'

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent-soft text-accent'
            : 'text-muted hover:bg-surface-hover hover:text-fg',
        )
      }
    >
      <Icon className="size-4.5 shrink-0" strokeWidth={2} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser()
  const visible = (item: NavItem) =>
    !item.minRole || ROLE_RANK[user.role] >= ROLE_RANK[item.minRole]

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="bg-accent text-on-accent grid size-7 place-items-center rounded-lg text-sm font-bold">
          M
        </span>
        <span className="text-fg text-base font-semibold tracking-tight">모아</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {PRIMARY_NAV.filter(visible).map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-line space-y-1 border-t px-3 py-3">
        {SECONDARY_NAV.filter(visible).map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* 데스크톱: 항상 고정 */}
      <aside className="border-line bg-surface hidden w-60 shrink-0 border-r md:block">
        <SidebarContent />
      </aside>

      {/* 모바일: 드로어 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="border-line bg-surface absolute inset-y-0 left-0 w-64 border-r shadow-xl">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="메뉴 닫기"
              className="absolute top-3 right-2 px-2"
            >
              <X className="size-4" />
            </Button>
            <SidebarContent onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  )
}
