import { Clock, FileText, House, Megaphone, MessagesSquare, Settings, Sparkles } from 'lucide-react'
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

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/docs', label: '문서', icon: FileText },
  { to: '/chat', label: '채팅', icon: MessagesSquare },
  { to: '/board', label: '게시판', icon: Megaphone },
  { to: '/attendance', label: '근태', icon: Clock },
  { to: '/ai', label: 'AI 어시스턴트', icon: Sparkles },
]

export const SECONDARY_NAV: NavItem[] = [{ to: '/settings', label: '설정', icon: Settings }]
