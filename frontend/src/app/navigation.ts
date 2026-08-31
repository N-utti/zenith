import {
  Bell,
  Clock,
  FileText,
  House,
  Megaphone,
  MessagesSquare,
  Settings,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role } from '@/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** 이 등급 미만이면 메뉴 자체를 숨긴다. 실제 차단은 서버 권한 검사가 담당한다. */
  minRole?: Role
  /** 하위 경로까지 활성 표시할지 여부 (홈만 정확히 일치). */
  end?: boolean
}

/**
 * 사이드바 최상단 그룹. 12·UI 청사진의 1b 셸에서 섹션 헤더 없이 먼저 오는 항목들이다.
 * 문서·채널·게시판은 여기 없다 — 각각 트리와 목록 섹션으로 따로 렌더한다.
 */
export const TOP_NAV: NavItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/notifications', label: '받은 알림', icon: Bell },
  { to: '/attendance', label: '근태', icon: Clock },
  { to: '/ai', label: 'AI 어시스턴트', icon: Sparkles },
]

export const SECONDARY_NAV: NavItem[] = [{ to: '/settings', label: '설정', icon: Settings }]

/** 모바일 하단 탭바. 와이어프레임 3a의 5개 탭. */
export const MOBILE_TABS: NavItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/docs', label: '문서', icon: FileText },
  { to: '/chat', label: '채팅', icon: MessagesSquare },
  { to: '/board', label: '게시판', icon: Megaphone },
  { to: '/notifications', label: '알림', icon: Bell },
]

/**
 * ⌘K가 이동할 수 있는 모든 화면. 사이드바는 문서·채널을 트리로 따로 그리지만
 * 팔레트는 목록 화면까지 한 번에 닿아야 해서 별도로 둔다.
 */
export const ALL_NAV: NavItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/docs', label: '문서', icon: FileText },
  { to: '/chat', label: '채팅', icon: MessagesSquare },
  { to: '/board', label: '게시판', icon: Megaphone },
  { to: '/attendance', label: '근태', icon: Clock },
  { to: '/ai', label: 'AI 어시스턴트', icon: Sparkles },
  { to: '/notifications', label: '받은 알림', icon: Bell },
  ...SECONDARY_NAV,
]
