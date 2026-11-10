import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { FileText, Globe, MessagesSquare, Plus, X, type LucideIcon } from 'lucide-react'
import { ALL_NAV } from '@/app/navigation'
import { useChannels } from '@/features/chat/api'
import { UNTITLED_DOC, useTree } from '@/features/docs/api'
import { setSplitDoc, useSplitDoc } from '@/features/docs/splitDoc'
import { cn } from '@/lib/cn'
import {
  activateTab,
  activeTab,
  closeTab,
  cycleTab,
  inAppTarget,
  openTab,
  updateActiveTab,
  useDesktopTabs,
  type DesktopTab,
} from './desktopTabs'

/** 탭 이름과 아이콘. 문서는 트리의 제목, 채팅은 채널 이름, 나머지는 메뉴 이름. */
function useTabLabel(path: string): { label: string; icon: LucideIcon } {
  const tree = useTree().data
  const channels = useChannels().data
  const pathname = path.split('?')[0]!
  const doc = /^\/docs\/([^/]+)$/.exec(pathname)?.[1]
  if (doc && doc !== 'trash') {
    const title = tree?.docs.find((d) => d.id === doc)?.title
    return { label: title || UNTITLED_DOC, icon: FileText }
  }
  const channel = /^\/chat\/([^/]+)/.exec(pathname)?.[1]
  if (channel) {
    const name = channels?.items.find((c) => c.id === channel)?.name
    return { label: name || '채팅', icon: MessagesSquare }
  }
  // 가장 길게 맞는 메뉴(`/crm/orgs` 는 CRM, `/docs/trash` 는 문서).
  const nav = ALL_NAV.filter((n) =>
    n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0]
  return nav ? { label: nav.label, icon: nav.icon } : { label: '제니스', icon: Globe }
}

function Tab({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: DesktopTab
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const { label, icon: Icon } = useTabLabel(tab.path)
  const ref = useRef<HTMLDivElement>(null)
  // 넘친 줄에서 지금 탭이 가려지지 않게(Ctrl+Tab 으로 옮겨 왔을 때 등).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div
      ref={ref}
      // 휠 클릭으로 닫는다(브라우저 탭처럼).
      onAuxClick={(e) => e.button === 1 && onClose()}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      className={cn(
        'group flex h-7 w-52 min-w-24 shrink items-center rounded-md text-sm',
        active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        data-tab
        aria-current={active ? 'page' : undefined}
        tabIndex={active ? 0 : -1}
        title={label}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pl-2.5 text-left"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`${label} 탭 닫기`}
        tabIndex={active ? 0 : -1}
        onClick={onClose}
        className={cn(
          'hover:bg-sunken mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded',
          !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * 탭으로 옮기며 그 탭의 오른쪽 문서를 띄울 차례. 주소가 바뀐 뒤에 띄운다. 먼저 띄우면 옛 주소와 한 번
 * 같이 그려지는데, 그때 옛 화면의 문서와 같으면 AppLayout 이 오른쪽 문서를 닫아 버린다.
 */
let pendingSplit: { path: string; split: string | null } | null = null

/**
 * 그 탭의 화면으로 옮긴다. 탭을 옮기는 일은 기록에 쌓지 않고 바꿔 끼운다.
 * ponytail: 기록은 탭들이 하나를 같이 쓴다. 새 탭에서 뒤로 가기를 누르면 앞 탭에서 보던 화면이 이 탭에
 * 적힌다(앞으로 가기로 돌아온다). 거슬리면 탭마다 기록을 따로 둔다.
 */
function showTab(tab: DesktopTab | null, navigate: NavigateFunction) {
  if (!tab) return
  // 라우터가 아니라 브라우저 주소를 본다. 앞 이동이 아직 그려지기 전에 또 누르면 라우터 값은 낡았다.
  if (tab.path === window.location.pathname + window.location.search) {
    pendingSplit = null
    return setSplitDoc(tab.split)
  }
  pendingSplit = { path: tab.path, split: tab.split }
  setSplitDoc(null)
  navigate(tab.path, { replace: true })
}

/** 복원은 앱이 켜질 때 한 번. AppLayout 은 두 벌이라 이 막대도 화면을 옮길 때 다시 마운트된다. */
let restored = false

/** 데스크톱 앱 맨 위 탭 줄. 상단바 위에 둔다(사용자가 고른 자리). */
export function DesktopTabBar() {
  const { tabs, active } = useDesktopTabs()
  const location = useLocation()
  const navigate = useNavigate()
  const split = useSplitDoc()
  const path = location.pathname + location.search

  // 화면을 옮기면 지금 탭의 주소로 적는다.
  // 켤 때는 지난번 탭으로 돌아간다. 로그인 화면을 거쳐 왔으면 그 화면(설정의 시작 화면)을 지금 탭에 둔다.
  useEffect(() => {
    if (!restored) {
      restored = true
      if (location.key === 'default') return showTab(activeTab(), navigate)
    }
    if (pendingSplit?.path === path) {
      setSplitDoc(pendingSplit.split)
      pendingSplit = null
    }
    updateActiveTab({ path })
  }, [path, location.key, navigate])

  useEffect(() => {
    if (restored && !pendingSplit) updateActiveTab({ split })
  }, [split])

  useEffect(() => {
    const show = (tab: DesktopTab | null) => showTab(tab, navigate)

    // 셸이 그대로 두면 주소창 없는 새 창이 뜬다.
    const onClick = (e: MouseEvent) => {
      const gesture = e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))
      if (e.defaultPrevented || !gesture) return
      const target = inAppTarget(e.target)
      if (!target) return
      e.preventDefault()
      openTab(target)
    }

    // 한글 조합 중에는 받지 않는다. 자판 배열과 상관없게 글쇠 자리(code)로 본다.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return
      // 누르고 있으면 탭이 줄줄이 열리고 닫힌다. 옮기기(Tab)만 되풀이를 받는다.
      if (e.repeat && e.code !== 'Tab') return
      if (e.code === 'KeyT' && !e.shiftKey) show(openTab('/', true))
      else if (e.code === 'KeyW' && !e.shiftKey) show(closeTab(activeTab().id))
      else if (e.code === 'Tab') show(cycleTab(e.shiftKey ? -1 : 1))
      else return
      e.preventDefault()
    }

    document.addEventListener('click', onClick)
    document.addEventListener('auxclick', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('auxclick', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [navigate])

  const show = (tab: DesktopTab | null) => showTab(tab, navigate)

  // 좌우 화살표로 탭 사이 초점을 옮긴다(고르기는 Enter·Space).
  const moveFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tab]')]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]!.focus()
  }

  return (
    <div className="border-line bg-sunken flex h-9 shrink-0 items-center gap-1 border-b px-2">
      <div
        role="navigation"
        aria-label="탭"
        onKeyDown={moveFocus}
        // 스크롤바를 감췄으니 마우스 휠로 넘친 탭을 옆으로 넘긴다.
        onWheel={(e) => {
          if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY
        }}
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === active}
            onSelect={() => show(activateTab(tab.id))}
            onClose={() => show(closeTab(tab.id))}
          />
        ))}
      </div>
      <button
        type="button"
        aria-label="새 탭 (Ctrl+T)"
        title="새 탭 (Ctrl+T)"
        onClick={() => show(openTab('/', true))}
        className="text-muted hover:bg-surface-hover grid size-7 shrink-0 cursor-pointer place-items-center rounded-md"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
