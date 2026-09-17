import type { NavItem } from '@/app/navigation'
import type { SearchHit } from './types'

/**
 * ⌘K 목록의 한 줄. 화면 이동·검색 결과·AI 행이 한 배열에 이어 붙는다.
 *
 * 세 덩어리를 따로 세면 화면에 없는 줄까지 커서가 세는 일이 생긴다. 검색어를 지웠는데
 * 직전 결과가 캐시에 남아 있으면, 결과 구획은 사라졌는데 커서는 그 칸을 계속 세서 아무것도
 * 강조되지 않는 구간이 생기고 거기서 Enter 를 누르면 안 보이는 문서로 간다.
 * 그려지는 것과 세는 것을 같은 배열 하나로 묶는다.
 */
export type PaletteRow =
  | { kind: 'nav'; nav: NavItem }
  | { kind: 'hit'; hit: SearchHit }
  | { kind: 'ask' }

/** 서버가 준 갈 곳만 따라간다. 우리가 아는 화면인지는 한 번 확인한다. */
const SAFE_TO = /^\/(docs|chat|board)\/[^/]/

export function isSafeTo(to: string): boolean {
  return SAFE_TO.test(to)
}

export function paletteRows(navItems: NavItem[], hits: SearchHit[]): PaletteRow[] {
  return [
    ...navItems.map((nav): PaletteRow => ({ kind: 'nav', nav })),
    ...hits.filter((hit) => isSafeTo(hit.to)).map((hit): PaletteRow => ({ kind: 'hit', hit })),
    { kind: 'ask' },
  ]
}

/** 화면에 그려지는 검색 결과. 목록과 커서가 같은 것을 봐야 한다. */
export function hitRows(rows: PaletteRow[]): SearchHit[] {
  return rows.flatMap((row) => (row.kind === 'hit' ? [row.hit] : []))
}
