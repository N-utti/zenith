import { Moon, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { useTheme } from '@/lib/theme'
import { UserMenu } from './UserMenu'

export function Header({
  onOpenSidebar,
  collapsed,
  onToggleCollapsed,
  onOpenCommandPalette,
}: {
  onOpenSidebar: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenCommandPalette: () => void
}) {
  const { theme, toggle } = useTheme()
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    <header className="border-line bg-surface z-30 flex h-[50px] shrink-0 items-center gap-3 border-b px-3 sm:px-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSidebar}
        aria-label="메뉴 열기"
        className="px-2 md:hidden"
      >
        <PanelLeft className="size-4.5" />
      </Button>
      {/* 데스크톱: 같은 자리의 버튼이 서랍이 아니라 고정 사이드바를 접고 편다. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? '사이드바 펴기' : '사이드바 접기'}
        aria-expanded={!collapsed}
        title={collapsed ? '사이드바 펴기' : '사이드바 접기'}
        className="hidden px-2 md:inline-flex"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4.5" />
        ) : (
          <PanelLeftClose className="size-4.5" />
        )}
      </Button>

      <Link to="/" className="flex shrink-0 items-center gap-1.5">
        <ZenithMark className="size-[22px]" />
        <span className="text-fg text-[14.5px] font-bold tracking-tight">제니스</span>
      </Link>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="border-line bg-canvas text-subtle hover:border-line-strong mx-auto flex h-[34px] max-w-[460px] flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">채팅·문서 전체 검색</span>
        <kbd className="text-subtle ml-auto hidden font-mono text-[11px] sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          className="px-2"
        >
          {theme === 'dark' ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </Button>
        <UserMenu />
      </div>
    </header>
  )
}
