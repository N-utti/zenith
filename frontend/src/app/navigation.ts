import {
  Archive,
  Bell,
  Building2,
  ClipboardCheck,
  Clock,
  FileText,
  House,
  Megaphone,
  MessagesSquare,
  Settings,
  ShieldUser,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROLE_RANK, type Role } from '@/types'

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
 * CRM 은 v1.1 이다(15 CRM 모듈 설계서 §12.2). 백엔드가 없어 목(MSW)으로만 돌고, 목은 개발
 * 빌드에서만 뜬다. 운영 빌드(파일럿)에서는 메뉴와 라우트를 같이 뺀다.
 */
export const CRM_ENABLED = import.meta.env.DEV

const CRM_NAV: NavItem[] = CRM_ENABLED ? [{ to: '/crm', label: 'CRM', icon: Building2 }] : []

/**
 * 자료실도 서버에 목록 경로(`GET /archive`)가 아직 없어 목으로만 돈다(README "백엔드에 요청한 것").
 * CRM 과 같이 개발 빌드에서만 메뉴와 라우트를 연다. 서버가 붙으면 이 스위치를 걷는다.
 */
export const ARCHIVE_ENABLED = import.meta.env.DEV

const ARCHIVE_NAV: NavItem[] = ARCHIVE_ENABLED
  ? [{ to: '/archive', label: '자료실', icon: Archive }]
  : []

/**
 * 사이드바 최상단 그룹. 12·UI 청사진의 1b 셸에서 섹션 헤더 없이 먼저 오는 항목들이다.
 * 문서·채널·게시판은 여기 없다. 각각 트리와 목록 섹션으로 따로 렌더한다.
 */
export const TOP_NAV: NavItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/notifications', label: '받은 알림', icon: Bell },
  { to: '/attendance', label: '근태', icon: Clock },
  { to: '/approvals', label: '결재', icon: ClipboardCheck },
  ...CRM_NAV,
  ...ARCHIVE_NAV,
  { to: '/ai', label: 'AI 어시스턴트', icon: Sparkles },
]

export const SECONDARY_NAV: NavItem[] = [
  { to: '/admin', label: '관리자', icon: ShieldUser, minRole: 'exec' },
  { to: '/settings', label: '설정', icon: Settings },
]

/**
 * 등급이 모자란 항목을 뺀다. 사이드바와 ⌘K 가 같은 함수를 쓴다.
 *
 * 숨기는 것은 편의다. 실제 차단은 서버의 403 이고, 주소를 직접 쳐서 들어가도 화면이 막는다.
 */
export function visibleNav(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole])
}

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
  { to: '/approvals', label: '결재', icon: ClipboardCheck },
  ...CRM_NAV,
  ...ARCHIVE_NAV,
  { to: '/ai', label: 'AI 어시스턴트', icon: Sparkles },
  { to: '/notifications', label: '받은 알림', icon: Bell },
  ...SECONDARY_NAV,
]
