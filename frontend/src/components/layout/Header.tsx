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
import { cn } from '@/lib/cn'
import { setContentWide, useContentWide } from '@/lib/contentWidth'
import { useTheme } from '@/lib/theme'
import { NotificationMenu } from './NotificationMenu'
import { UserMenu } from './UserMenu'

export function Header({
  onOpenSidebar,
  collapsed,
  onToggleCollapsed,
  onOpenCommandPalette,
  showWidthToggle,
}: {
  onOpenSidebar: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenCommandPalette: () => void
  showWidthToggle: boolean
}) {
  const { theme, toggle } = useTheme()
  const wide = useContentWide()
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    // 세 칸 격자다. 양옆 칸이 남는 폭을 똑같이 나눠 가져 검색창이 헤더 정중앙에 선다. 한 줄
    // flex 로 두면 검색창은 좌우 묶음 "사이" 의 가운데라, 오른쪽 버튼 수가 달라지는 화면
    // (본문 너비 버튼이 없는 채팅·AI·문서 편집)을 오갈 때마다 옆으로 밀린다.
    // 좁은 화면에서는 양옆이 제 내용 폭을 지키고(최소 max-content) 검색창이 줄어든다(최소 0).
    // 양옆 최소를 그냥 1fr 로 두면 0 까지 줄 수 있다고 계산되어 검색창이 로고와 버튼을 덮는다.
    <header className="border-line bg-surface z-30 grid h-[50px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,460px)_minmax(max-content,1fr)] items-center gap-3 border-b px-3 sm:px-4">
      <div className="flex items-center gap-3">
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

        {/* 로고 그림은 alt 가 비어 있으므로 링크 이름을 여기서 준다. */}
        <Link
          to="/"
          aria-label="제니스 홈"
          title="제니스 홈"
          className="flex shrink-0 items-center"
        >
          <ZenithMark className="size-[22px]" />
        </Link>
      </div>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="border-line bg-canvas text-subtle hover:border-line-strong flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">문서·채팅·게시글 전체 검색</span>
        <kbd className="text-subtle ml-auto hidden font-mono text-[11px] sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center justify-self-end gap-1">
        {/* 본문이 최대폭(max-w-6xl, 1152px)에 닿아야 눌러서 달라진다. 사이드바(300px)를 편 채로는
            1470px 쯤부터, 접으면 xl 부터 닿는다. 그보다 좁은 화면과 꽉 채우는 화면(bleed)에서는 숨긴다. */}
        {showWidthToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setContentWide(!wide)}
            aria-label="본문 넓게 보기"
            aria-pressed={wide}
            title={wide ? '본문 기본 너비로' : '본문 넓게 보기'}
            className={cn('hidden px-2', collapsed ? 'xl:inline-flex' : 'min-[1470px]:inline-flex')}
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
        <NotificationMenu />
        <UserMenu />
      </div>
    </header>
  )
}
