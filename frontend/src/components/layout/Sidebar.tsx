import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SECONDARY_NAV, TOP_NAV, type NavItem } from '@/app/navigation'
import { useBoards } from '@/features/board/api'
import { useChannels } from '@/features/chat/api'
import { Button } from '@/components/ui/Button'
import { MaskedRow } from '@/components/ui/MaskedRow'
import { DocTree } from './DocTree'

const ROW = 'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors'
const ROW_IDLE = 'text-muted hover:bg-surface-hover hover:text-fg'
const ROW_ACTIVE = 'bg-accent-soft text-accent font-semibold'

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-subtle mt-4 mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
      {children}
    </div>
  )
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

function ChannelSection({ onNavigate }: { onNavigate?: () => void }) {
  // 채팅은 MSW가 아니라 개발 서버로 간다. 안 떠 있으면 섹션을 통째로 접는다.
  const { data } = useChannels()
  const channels = (data?.items ?? []).filter((channel) => channel.kind === 'channel')
  if (channels.length === 0) return null

  return (
    <>
      <SectionLabel>채널</SectionLabel>
      {channels.map((channel) => (
        <NavLink
          key={channel.id}
          to={`/chat/${channel.id}`}
          onClick={onNavigate}
          className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
        >
          <span className="text-subtle shrink-0">#</span>
          <span className="truncate">{channel.name}</span>
          {channel.unread > 0 && (
            <span className="bg-muted text-surface ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-bold">
              {channel.unread}
            </span>
          )}
        </NavLink>
      ))}
    </>
  )
}

function BoardSection({ onNavigate }: { onNavigate?: () => void }) {
  // 게시판 정의와 열람 권한은 서버가 준다. 프론트가 등급을 계산하지 않는다.
  const { data } = useBoards()
  const location = useLocation()

  return (
    <>
      <SectionLabel>게시판</SectionLabel>
      {(data?.items ?? []).map((board) => {
        const active = location.pathname.startsWith(`/board/${board.id}`)

        return (
          <MaskedRow
            key={board.id}
            masked={!board.allowed}
            to={board.allowed ? `/board/${board.id}` : undefined}
            onNavigate={onNavigate}
            className={cn(ROW, board.allowed && (active ? ROW_ACTIVE : ROW_IDLE))}
          >
            <span className="truncate">{board.name}</span>
            <span className="bg-sunken text-subtle ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold">
              {board.badge}
            </span>
          </MaskedRow>
        )
      })}
    </>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {TOP_NAV.map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}

        <SectionLabel>워크스페이스</SectionLabel>
        <DocTree onNavigate={onNavigate} />

        <ChannelSection onNavigate={onNavigate} />
        <BoardSection onNavigate={onNavigate} />
      </nav>

      <div className="border-line border-t px-2 py-2">
        {SECONDARY_NAV.map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* 데스크톱: 항상 고정. 폭 270px은 12·UI 청사진 1b 셸 치수다. */}
      <aside className="border-line bg-sunken hidden w-[270px] shrink-0 border-r md:block">
        <SidebarContent />
      </aside>

      {/* 모바일: 왼쪽 서랍 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="border-line bg-sunken absolute inset-y-0 left-0 w-[270px] border-r shadow-xl">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="메뉴 닫기"
              className="absolute top-2 right-2 z-10 px-2"
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
