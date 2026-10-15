import { memo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useMatch } from 'react-router'
import { AtSign, ChevronDown, ChevronRight, Lock, Pencil, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { SECONDARY_NAV, TOP_NAV, visibleNav, type NavItem } from '@/app/navigation'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useBoards } from '@/features/board/api'
import { BOARD_BADGE } from '@/features/board/types'
import { useChannels } from '@/features/chat/api'
import { useHasDraft } from '@/features/chat/drafts'
import { NewChatModal } from '@/features/chat/NewChatModal'
import { WorkStatus } from '@/features/chat/WorkStatus'
import type { ChatChannel } from '@/features/chat/types'
import { useUnreadNotificationCount } from '@/features/notifications/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MaskedRow } from '@/components/ui/MaskedRow'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { usePanelWidth } from '@/lib/usePanelWidth'
import { DocTree } from './DocTree'

const ROW = 'flex items-center gap-2 rounded-md px-2.5 py-2 text-[15px] transition-colors'
const ROW_IDLE = 'text-muted hover:bg-surface-hover hover:text-fg'
const ROW_ACTIVE = 'bg-accent-soft text-accent font-semibold'

const SECTIONS_KEY = 'zenith.sidebarSectionsCollapsed'

/**
 * 사용자가 접어 둔 구획. 문서 트리의 폴더 펼침과 같은 까닭으로 브라우저에 남긴다. AppLayout 이
 * bleed 유무로 두 벌이라 컴포넌트 상태만으로는 화면을 옮길 때마다 다시 펼쳐진다.
 */
const collapsedSections = readCollapsedSections()

function readCollapsedSections(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function useSectionCollapsed(id: string) {
  const [collapsed, setCollapsed] = useState(() => collapsedSections.has(id))
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    if (next) collapsedSections.add(id)
    else collapsedSections.delete(id)
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify([...collapsedSections]))
    } catch {
      // 저장 못 해도 이번 마운트의 접힘은 유지된다.
    }
  }
  return [collapsed, toggle] as const
}

/** 구획 제목. 제목을 누르면 그 구획이 접힌다. 화살표는 문서 트리의 폴더 줄과 같은 모양이다. */
function SectionLabel({
  children,
  action,
  collapsed,
  onToggle,
}: {
  children: ReactNode
  action?: ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    // 왼쪽 여백은 화살표가 문서 트리의 폴더 화살표와 같은 세로줄에 서게 맞춘 값이다.
    <div className="text-subtle mt-4 mb-1.5 flex items-center gap-1 pr-2.5 pl-[3px] text-[13px] font-bold tracking-[0.08em]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        // 글자가 작아 줄 높이만으로는 손가락에 빗나간다. 위아래로 6px 씩 넓게 받는다.
        className="hover:text-fg relative flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded text-left transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5"
      >
        <Chevron className="size-3.5 shrink-0" />
        {children}
      </button>
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
      className="text-subtle hover:text-fg grid size-6 shrink-0 cursor-pointer place-items-center rounded transition-colors"
    >
      <Plus className="size-4" />
    </button>
  )
}

/** 안 읽은 개수 알약. 채널 행과 「받은 알림」 행이 같은 모양을 쓴다. */
function UnreadPill({ count }: { count: number }) {
  return (
    <span className="bg-muted text-surface ml-auto shrink-0 rounded-full px-1.5 text-xs font-bold">
      {/* 낭독기가 앞의 이름과 붙여 읽지 않게 끊는다("받은 알림3개" 가 아니라 "받은 알림, 3개"). */}
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only">개 안 읽음</span>
    </span>
  )
}

function NavRow({
  item,
  unread = 0,
  onNavigate,
}: {
  item: NavItem
  unread?: number
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={2} />
      <span className="truncate">{item.label}</span>
      {unread > 0 && <UnreadPill count={unread} />}
    </NavLink>
  )
}

function ChannelRow({ channel, onNavigate }: { channel: ChatChannel; onNavigate?: () => void }) {
  const hasDraft = useHasDraft(channel.id)
  return (
    <NavLink
      to={`/chat/${channel.id}`}
      onClick={onNavigate}
      className={({ isActive }) => cn(ROW, 'group', isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      {channel.is_dm ? (
        <AtSign className="text-subtle size-4 shrink-0" />
      ) : channel.is_private ? (
        <Lock role="img" aria-label="비공개" className="text-subtle size-4 shrink-0" />
      ) : (
        // 자물쇠와 같은 폭을 준다. 글자 폭대로 두면 공개·비공개 행의 이름이 서로 어긋난다.
        <span className="text-subtle w-4 shrink-0 text-center">#</span>
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{channel.name}</span>
        <WorkStatus channel={channel} />
        {/* 쓰다 만 글이 있는 방. 지금 보고 있는 방은 입력창에 글이 보이므로 감춘다. */}
        {hasDraft && (
          <Pencil
            role="img"
            aria-label="작성 중"
            className="text-subtle size-3.5 shrink-0 group-aria-[current=page]:hidden"
          />
        )}
      </span>
      {channel.unread > 0 && <UnreadPill count={channel.unread} />}
    </NavLink>
  )
}

export function ChannelSection({ onNavigate }: { onNavigate?: () => void }) {
  // 채팅은 MSW가 아니라 개발 서버로 간다. 안 떠 있으면 구획을 통째로 그리지 않는다.
  // 데스크톱 채팅 화면에는 방 목록이 따로 없다. 이 섹션이 곧 방 목록이라 DM 도 여기 둔다.
  const { data } = useChannels()
  const [creating, setCreating] = useState<'channel' | 'dm' | null>(null)
  const [channelsCollapsed, toggleChannels] = useSectionCollapsed('channels')
  const [dmsCollapsed, toggleDms] = useSectionCollapsed('dms')
  const activeId = useMatch('/chat/:channelId')?.params.channelId
  const channels = (data?.items ?? []).filter((channel) => !channel.is_dm)
  const dms = (data?.items ?? []).filter((channel) => channel.is_dm)
  if (data === undefined) return null

  // 접어도 안 읽은 방과 지금 보고 있는 방은 남긴다. 통째로 숨기면 새 메시지가 온 줄 모른다.
  const shown = (rooms: ChatChannel[], collapsed: boolean) =>
    collapsed ? rooms.filter((room) => room.unread > 0 || room.id === activeId) : rooms

  return (
    <>
      <SectionLabel
        collapsed={channelsCollapsed}
        onToggle={toggleChannels}
        action={<AddButton label="새 채널" onClick={() => setCreating('channel')} />}
      >
        채널
      </SectionLabel>
      {!channelsCollapsed && channels.length === 0 && (
        <p className="text-subtle px-3 py-1 text-[13px]">아직 채널이 없습니다.</p>
      )}
      {shown(channels, channelsCollapsed).map((channel) => (
        <ChannelRow key={channel.id} channel={channel} onNavigate={onNavigate} />
      ))}

      <SectionLabel
        collapsed={dmsCollapsed}
        onToggle={toggleDms}
        action={<AddButton label="새 대화" onClick={() => setCreating('dm')} />}
      >
        다이렉트 메시지
      </SectionLabel>
      {!dmsCollapsed && dms.length === 0 && (
        <p className="text-subtle px-3 py-1 text-[13px]">아직 대화가 없습니다.</p>
      )}
      {shown(dms, dmsCollapsed).map((channel) => (
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
  const [collapsed, toggle] = useSectionCollapsed('boards')

  return (
    <>
      <SectionLabel collapsed={collapsed} onToggle={toggle}>
        게시판
      </SectionLabel>
      {(collapsed ? [] : (data?.items ?? [])).map((board) => {
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
            {/* 등급 배지는 공용 Badge 하나로만 그린다(12 §4.1). 게시판 목록과 같은 톤. */}
            <Badge className="ml-auto shrink-0">{BOARD_BADGE[board.min_role]}</Badge>
          </MaskedRow>
        )
      })}
    </>
  )
}

// 폭을 끄는 동안 Sidebar 가 이동마다 다시 그려진다. 넘기는 값이 같으면 내용(트리·채널)은 건너뛴다.
export const SidebarContent = memo(function SidebarContent({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const { role } = useCurrentUser()
  const unreadNotifications = useUnreadNotificationCount()
  const [docsCollapsed, toggleDocs] = useSectionCollapsed('docs')

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {visibleNav(TOP_NAV, role).map((item) => (
          <NavRow
            key={item.to}
            item={item}
            unread={item.to === '/notifications' ? unreadNotifications : 0}
            onNavigate={onNavigate}
          />
        ))}

        <SectionLabel collapsed={docsCollapsed} onToggle={toggleDocs}>
          워크스페이스
        </SectionLabel>
        {!docsCollapsed && <DocTree onNavigate={onNavigate} />}

        <ChannelSection onNavigate={onNavigate} />
        <BoardSection onNavigate={onNavigate} />
      </nav>

      <div className="border-line border-t px-2 py-2">
        {visibleNav(SECONDARY_NAV, role).map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
})

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
  const drawerRef = useRef<HTMLElement>(null)
  // 대화상자 규약(12 UI 청사진 §8): 열리면 포커스를 가두고, Esc 로 닫고, 닫히면 연 버튼(헤더의
  // 메뉴 버튼)으로 포커스를 되돌린다. 로직은 공용 Modal 에서 뽑아낸 훅을 그대로 쓴다.
  useFocusTrap(open, drawerRef, onClose)
  const panel = usePanelWidth('zenith.sidebarWidth', 300, 220, 480, 0.25)

  return (
    <>
      {/* 데스크톱: 고정. 기본 폭 300px. 12·UI 청사진 1b 셸 치수(270px)에서 글자를 키우며 같이 넓혔다. 오른쪽 경계를 끌어 폭을 바꾼다.
          접으면 폭을 0 으로 밀어 넣는다(아이콘 레일 없음).
          안쪽은 폭을 고정해 줄어드는 동안 내용이 찌그러지지 않고, 마운트를 유지해 문서 트리의 펼침이 남는다.
          접힌 동안은 inert 로 탭 이동에서도 뺀다. */}
      <aside
        inert={collapsed}
        style={{ width: collapsed ? 0 : panel.width, maxWidth: panel.maxWidth }}
        className={cn(
          'border-line bg-sunken hidden shrink-0 overflow-hidden md:block',
          'motion-safe:transition-[width,border-color] motion-safe:duration-200 motion-safe:ease-out',
          collapsed ? 'border-r border-transparent' : 'border-r',
        )}
      >
        <div className="h-full" style={{ width: panel.width, maxWidth: panel.maxWidth }}>
          <SidebarContent />
        </div>
      </aside>
      {!collapsed && (
        <ResizeHandle panel={panel} side="right" label="사이드바 폭" className="hidden md:block" />
      )}

      {/* 모바일: 왼쪽 서랍 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="메뉴"
            tabIndex={-1}
            className="border-line bg-sunken absolute inset-y-0 left-0 w-[300px] border-r shadow-xl outline-none"
          >
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
