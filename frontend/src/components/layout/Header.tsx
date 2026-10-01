import {
  FoldHorizontal,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  UnfoldHorizontal,
} from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ZenithMark } from '@/components/ui/ZenithMark'
import { setContentWide, useContentWide } from '@/lib/contentWidth'
import { useTheme } from '@/lib/theme'
import { UserMenu } from './UserMenu'

export function Header({
  onOpenSidebar,
  collapsed,
  onToggleCollapsed,
  onOpenCommandPalette,
  showWidthToggle,
}: {
  showWidthToggle: boolean
  onOpenSidebar: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenCommandPalette: () => void
}) {
  const { theme, toggle } = useTheme()
  const wide = useContentWide()
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

      {/* min-w-0: 이게 없으면 flex 항목이 제 내용 폭(약 164px) 밑으로 줄지 않아, 좁은 화면에서
          오른쪽의 테마·아바타를 화면 밖으로 밀어낸다. 375px 에서 문서 전체가 15px 넘쳤다
          (scrollWidth 390). 안쪽 span 은 truncate 라 0 까지 줄지만 버튼 자신이 안 줄었다. */}
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="border-line bg-canvas text-subtle hover:border-line-strong mx-auto flex h-[34px] min-w-0 max-w-[460px] flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">문서·채팅·게시글 전체 검색</span>
        <kbd className="text-subtle ml-auto hidden font-mono text-[11px] sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {/* 본문이 최대폭(max-w-6xl)에 닿는 넓은 화면에서만 뜻이 있다. 좁은 화면과 꽉 채우는 화면(bleed)에서는 숨긴다. */}
        {showWidthToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setContentWide(!wide)}
            aria-label={wide ? '본문 기본 너비로' : '본문 넓게 보기'}
            aria-pressed={wide}
            title={wide ? '본문 기본 너비로' : '본문 넓게 보기'}
            className="hidden px-2 xl:inline-flex"
          >
            {wide ? (
              <FoldHorizontal className="size-4.5" />
            ) : (
              <UnfoldHorizontal className="size-4.5" />
            )}
          </Button>
        )}
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
