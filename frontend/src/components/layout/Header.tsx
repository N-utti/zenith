import { Bell, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme'
import { UserMenu } from './UserMenu'

export function Header({
  onOpenSidebar,
  onOpenCommandPalette,
}: {
  onOpenSidebar: () => void
  onOpenCommandPalette: () => void
}) {
  const { theme, toggle } = useTheme()
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    <header className="border-line bg-surface/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSidebar}
        aria-label="메뉴 열기"
        className="px-2 md:hidden"
      >
        <PanelLeft className="size-4.5" />
      </Button>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="border-line bg-sunken text-subtle hover:border-line-strong flex h-9 max-w-md flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">문서·채팅·사람 검색</span>
        <kbd className="border-line bg-surface text-subtle ml-auto hidden rounded border px-1.5 py-0.5 font-sans text-[11px] sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          className="px-2"
        >
          {theme === 'dark' ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </Button>
        <Button variant="ghost" size="sm" aria-label="알림" className="px-2">
          <Bell className="size-4.5" />
        </Button>
        <UserMenu />
      </div>
    </header>
  )
}
