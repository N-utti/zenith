import { ChevronDown, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme'
import { UserMenu } from './UserMenu'

/**
 * 온프레미스 단일 테넌트라 조직은 하나뿐이다. 워크스페이스 전환 UI는 청사진의
 * 자리만 잡아 두고, 실제 전환은 다중 조직이 생길 때 붙인다.
 */
const ORG_NAME = '우리회사'

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

      <Link to="/" className="flex shrink-0 items-center gap-1.5">
        <span className="text-fg text-[14.5px] font-bold tracking-tight">제니스</span>
        <span className="text-subtle hidden items-center gap-0.5 text-[14.5px] sm:flex">
          · {ORG_NAME}
          <ChevronDown className="size-3.5" />
        </span>
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
