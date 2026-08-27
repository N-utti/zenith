import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppLayout() {
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
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
