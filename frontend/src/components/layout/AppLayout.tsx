import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { cn } from '@/lib/cn'
import { useContentWide } from '@/lib/contentWidth'
import { ConnectionBanner } from './ConnectionBanner'
import { Header } from './Header'
import { MobileTabBar } from './MobileTabBar'
import { Sidebar } from './Sidebar'

const COLLAPSED_KEY = 'zenith.sidebarCollapsed'

/** AppLayout 은 bleed 유무로 두 벌이라 컴포넌트 상태만으로는 화면을 옮길 때 접힘이 풀린다. 브라우저에 남긴다. */
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 12·UI 청사진 1b 셸. 상단바가 전체 폭을 잡고, 그 아래에 트리 사이드바와 본문이 나란히 선다.
 *
 * bleed: 본문 패딩과 최대폭을 없애고 스크롤을 안쪽 패널에 맡긴다.
 * 문서 에디터처럼 화면을 꽉 채우고 영역별로 따로 스크롤해야 하는 화면용.
 */
export function AppLayout({ bleed = false }: { bleed?: boolean }) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const wide = useContentWide()

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // 저장 못 해도 이번 세션의 접힘은 유지된다.
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* 본문이 터져도 상단바·사이드바는 남긴다. 주소가 바뀌면 key 로 새로 만들어져 저절로 풀린다. */
  const body = (
    <ErrorBoundary key={location.pathname} inline>
      <Outlet />
    </ErrorBoundary>
  )

  return (
    <div className="bg-canvas flex h-full flex-col">
      <Header
        onOpenSidebar={() => setSidebarOpen(true)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        showWidthToggle={!bleed}
      />
      <ConnectionBanner />

      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} collapsed={collapsed} onClose={() => setSidebarOpen(false)} />

        {/* 스크롤바 자리를 늘 비워 둔다. 긴 화면에서 짧은 화면(탭 전환)으로 갈 때 스크롤바가
            사라지며 본문이 옆으로 움직이지 않게. */}
        <main
          className={cn(
            'min-w-0 flex-1',
            bleed ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]',
          )}
        >
          {bleed ? (
            body
          ) : (
            <div className={cn('mx-auto px-4 py-6 sm:px-6 sm:py-8', !wide && 'max-w-6xl')}>
              {body}
            </div>
          )}
        </main>
      </div>

      <MobileTabBar />

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
