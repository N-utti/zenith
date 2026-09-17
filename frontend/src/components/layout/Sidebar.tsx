import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { AtSign, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SECONDARY_NAV, TOP_NAV, type NavItem } from '@/app/navigation'
import { useBoards } from '@/features/board/api'
import { useChannels } from '@/features/chat/api'
import { NewChatModal } from '@/features/chat/NewChatModal'
import { WorkStatus } from '@/features/chat/WorkStatus'
import type { ChatChannel } from '@/features/chat/types'
import { Button } from '@/components/ui/Button'
import { MaskedRow } from '@/components/ui/MaskedRow'
import { DocTree } from './DocTree'

const ROW = 'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors'
const ROW_IDLE = 'text-muted hover:bg-surface-hover hover:text-fg'
const ROW_ACTIVE = 'bg-accent-soft text-accent font-semibold'

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-subtle mt-4 mb-1.5 flex items-center gap-1 px-2.5 text-[11px] font-bold tracking-[0.08em]">
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}

/** 구획 제목 옆의 작은 만들기 버튼. 제목 줄이 좁아 아이콘만 둔다. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-subtle hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors"
    >
      <Plus className="size-3.5" />
    </button>
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

function ChannelRow({ channel, onNavigate }: { channel: ChatChannel; onNavigate?: () => void }) {
  return (
    <NavLink
      to={`/chat/${channel.id}`}
      onClick={onNavigate}
      className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      {!channel.is_dm ? (
        <span className="text-subtle shrink-0">#</span>
      ) : (
        <AtSign className="text-subtle size-4 shrink-0" />
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{channel.name}</span>
        <WorkStatus channel={channel} />
      </span>
      {channel.unread > 0 && (
        <span className="bg-muted text-surface ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-bold">
          {channel.unread}
        </span>
      )}
    </NavLink>
  )
}

function ChannelSection({ onNavigate }: { onNavigate?: () => void }) {
  // 채팅은 MSW가 아니라 개발 서버로 간다. 안 떠 있으면 섹션을 통째로 접는다.
  // 데스크톱 채팅 화면에는 방 목록이 따로 없다. 이 섹션이 곧 방 목록이라 DM 도 여기 둔다.
  const { data } = useChannels()
  const [creating, setCreating] = useState<'channel' | 'dm' | null>(null)
  const channels = (data?.items ?? []).filter((channel) => !channel.is_dm)
  const dms = (data?.items ?? []).filter((channel) => channel.is_dm)
  if (data === undefined) return null

  return (
    <>
      <SectionLabel action={<AddButton label="새 채널" onClick={() => setCreating('channel')} />}>
        채널
      </SectionLabel>
      {channels.length === 0 && (
        <p className="text-subtle px-3 py-1 text-xs">아직 채널이 없습니다.</p>
      )}
      {channels.map((channel) => (
        <ChannelRow key={channel.id} channel={channel} onNavigate={onNavigate} />
      ))}

      <SectionLabel action={<AddButton label="새 대화" onClick={() => setCreating('dm')} />}>
        다이렉트 메시지
      </SectionLabel>
      {dms.length === 0 && <p className="text-subtle px-3 py-1 text-xs">아직 대화가 없습니다.</p>}
      {dms.map((channel) => (
        <ChannelRow key={channel.id} channel={channel} onNavigate={onNavigate} />
      ))}

      {creating && (
        <NewChatModal
          mode={creating}
          // 취소는 모달만 닫는다. 여기서 서랍까지 닫으면 잘못 열었다 닫았을 뿐인데 메뉴가 사라진다.
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null)
            onNavigate?.()
          }}
        />
      )}
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

export function Sidebar({
  open,
  collapsed,
  onClose,
}: {
  open: boolean
  /** 데스크톱에서 접힘. AI 처럼 화면 안에 패널이 하나 더 있을 때 자리를 내준다. */
  collapsed: boolean
  onClose: () => void
}) {
  return (
    <>
      {/* 데스크톱: 고정. 폭 270px은 12·UI 청사진 1b 셸 치수다. 접으면 폭을 0 으로 밀어 넣는다(아이콘 레일 없음).
          안쪽은 폭을 고정해 줄어드는 동안 내용이 찌그러지지 않고, 마운트를 유지해 문서 트리의 펼침이 남는다.
          접힌 동안은 inert 로 탭 이동에서도 뺀다. */}
      <aside
        inert={collapsed}
        className={cn(
          'border-line bg-sunken hidden shrink-0 overflow-hidden md:block',
          'motion-safe:transition-[width,border-color] motion-safe:duration-200 motion-safe:ease-out',
          collapsed ? 'w-0 border-r border-transparent' : 'w-[270px] border-r',
        )}
      >
        <div className="h-full w-[270px]">
          <SidebarContent />
        </div>
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
