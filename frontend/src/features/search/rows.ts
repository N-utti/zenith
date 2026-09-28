import type { NavItem } from '@/app/navigation'
import type { ChatChannel } from '@/features/chat/types'
import type { SearchHit } from './types'

/**
 * ⌘K 목록의 한 줄. 화면 이동·채팅방·검색 결과·AI 행이 한 배열에 이어 붙는다.
 *
 * 세 덩어리를 따로 세면 화면에 없는 줄까지 커서가 세는 일이 생긴다. 검색어를 지웠는데
 * 직전 결과가 캐시에 남아 있으면, 결과 구획은 사라졌는데 커서는 그 칸을 계속 세서 아무것도
 * 강조되지 않는 구간이 생기고 거기서 Enter 를 누르면 안 보이는 문서로 간다.
 * 그려지는 것과 세는 것을 같은 배열 하나로 묶는다.
 */
export type PaletteRow =
  | { kind: 'nav'; nav: NavItem }
  | { kind: 'room'; room: ChatChannel }
  | { kind: 'hit'; hit: SearchHit }
  | { kind: 'ask' }

/** 서버가 준 갈 곳만 따라간다. 우리가 아는 화면인지는 한 번 확인한다. */
const SAFE_TO = /^\/(docs|chat|board)\/[^/]/

export function isSafeTo(to: string): boolean {
  return SAFE_TO.test(to)
}

/** 방 이름이 길게 맞아도 본문 검색 결과를 밀어내지 않게 자른다. */
const MAX_ROOMS = 5

/**
 * 이름에 검색어가 든 채널·DM. DM 의 이름은 상대 이름이라 사람 이름으로 치면 그 사람과의 대화로 간다.
 * 목록은 사이드바가 이미 받아 둔 내 방(`GET /channels`)이라 권한 밖 방은 애초에 없다.
 *
 * 순서는 이름으로 정한다(검색어로 시작하는 방 먼저). 받은 목록은 새 메시지가 올 때마다 최근 대화순으로
 * 다시 섞이는데(`withLastMessage`), 그 순서를 따르면 커서를 둔 줄에 다른 방이 올라와 Enter 가 엉뚱한
 * 방으로 간다. 사이드바처럼 `#개발` 로 쳐도 걸리게 앞의 `#`·`@` 는 떼고 비교한다.
 */
export function matchRooms(rooms: ChatChannel[], query: string): ChatChannel[] {
  const q = query.trim().replace(/^[#@]/, '').toLowerCase()
  if (!q) return []
  const starts = (room: ChatChannel) => (room.name.toLowerCase().startsWith(q) ? 0 : 1)
  return rooms
    .filter((room) => room.name.toLowerCase().includes(q))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, MAX_ROOMS)
}

export function paletteRows(
  navItems: NavItem[],
  rooms: ChatChannel[],
  hits: SearchHit[],
): PaletteRow[] {
  return [
    ...navItems.map((nav): PaletteRow => ({ kind: 'nav', nav })),
    ...rooms.map((room): PaletteRow => ({ kind: 'room', room })),
    ...hits.filter((hit) => isSafeTo(hit.to)).map((hit): PaletteRow => ({ kind: 'hit', hit })),
    { kind: 'ask' },
  ]
}

export function roomRows(rows: PaletteRow[]): ChatChannel[] {
  return rows.flatMap((row) => (row.kind === 'room' ? [row.room] : []))
}

/** 화면에 그려지는 검색 결과. 목록과 커서가 같은 것을 봐야 한다. */
export function hitRows(rows: PaletteRow[]): SearchHit[] {
  return rows.flatMap((row) => (row.kind === 'hit' ? [row.hit] : []))
}
