import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { cn } from '@/lib/cn'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

/**
 * bleed: 본문 패딩과 최대폭을 없애고 스크롤을 안쪽 패널에 맡긴다.
 * 문서 에디터처럼 화면을 꽉 채우고 영역별로 따로 스크롤해야 하는 화면용.
 */
export function AppLayout({ bleed = false }: { bleed?: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  return (
    <div className="bg-canvas flex h-full">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
        />
        <main className={cn('min-h-0 flex-1', bleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {bleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
