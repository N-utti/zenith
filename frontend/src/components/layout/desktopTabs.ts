import { useSyncExternalStore } from 'react'
import { isDesktopShell } from '@/lib/desktop'
import { uuid } from '@/lib/uuid'

/**
 * 데스크톱 앱의 탭(노션처럼). 브라우저에는 자체 탭이 있어 셸에서만 쓴다.
 *
 * 탭은 주소만 기억하고 화면은 고른 탭 하나만 그린다. 다 살려 두면 문서 탭마다 협업 연결이 붙어 무겁다.
 * 화면 나눠 보기(오른쪽 문서)는 탭마다 따로 둔다(사용자 결정). 껐다 켜도 남게 브라우저 저장소에 둔다.
 * 탭에는 앞사람이 보던 주소(결재·방 id, 검색어)가 들어 있어 주인을 함께 적고, 사람이 바뀌면 버린다.
 */
export interface DesktopTab {
  id: string
  /** 경로 + 쿼리. 예: `/docs/abc`, `/chat/c1?m=9` */
  path: string
  /** 그 탭에서 오른쪽에 띄운 문서 id. */
  split: string | null
}

interface State {
  tabs: DesktopTab[]
  active: string
  /** 이 탭들을 연 사람의 id. */
  owner?: string
}

const KEY = 'zenith.desktopTabs'

const newId = uuid
const single = (path: string): State => {
  const id = newId()
  return { tabs: [{ id, path, split: null }], active: id }
}

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null
    if (saved?.tabs?.length && saved.tabs.some((t) => t.id === saved.active)) return saved
  } catch {
    // 못 읽으면 지금 화면 하나로 시작한다.
  }
  return single(location.pathname + location.search)
}

let state = load()
const listeners = new Set<() => void>()

function commit(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 못 해도 이번 실행 동안은 남는다.
  }
  listeners.forEach((listener) => listener())
}

const indexOf = (id: string) => state.tabs.findIndex((t) => t.id === id)
export const activeTab = () => state.tabs[indexOf(state.active)]!

/** 지금 탭의 주소·오른쪽 문서를 바꾼다(화면을 옮기면 부른다). 같으면 건드리지 않는다. */
export function updateActiveTab(patch: Partial<Omit<DesktopTab, 'id'>>) {
  const current = activeTab()
  const next = { ...current, ...patch }
  if (next.path === current.path && next.split === current.split) return
  commit({ ...state, tabs: state.tabs.map((t) => (t.id === current.id ? next : t)) })
}

/** 지금 탭 바로 오른쪽에 연다. `activate` 면 그 탭으로 옮기고 그 탭을 돌려준다(주소 이동은 부른 쪽이). */
export function openTab(path: string, activate = false): DesktopTab {
  const tab = { id: newId(), path, split: null }
  const tabs = [...state.tabs]
  tabs.splice(indexOf(state.active) + 1, 0, tab)
  commit({ ...state, tabs, active: activate ? tab.id : state.active })
  return tab
}

/** 고른 탭으로 옮긴다. 옮겨 간 탭을 돌려준다. */
export function activateTab(id: string): DesktopTab | null {
  const tab = state.tabs[indexOf(id)]
  if (!tab || id === state.active) return null
  commit({ ...state, active: id })
  return tab
}

/** 왼쪽(-1)·오른쪽(+1) 탭으로. 끝에서는 반대쪽 끝으로 돈다. */
export function cycleTab(delta: 1 | -1): DesktopTab | null {
  const n = state.tabs.length
  return activateTab(state.tabs[(indexOf(state.active) + delta + n) % n]!.id)
}

/**
 * 탭을 닫는다. 마지막 하나는 닫지 않는다. 지금 탭을 닫으면 오른쪽(없으면 왼쪽) 탭으로 옮기고 그 탭을 돌려준다.
 * 다른 탭을 닫으면 `null`(화면은 그대로).
 */
export function closeTab(id: string): DesktopTab | null {
  const i = indexOf(id)
  if (i < 0 || state.tabs.length === 1) return null
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (id !== state.active) {
    commit({ ...state, tabs })
    return null
  }
  const next = tabs[Math.min(i, tabs.length - 1)]!
  commit({ ...state, tabs, active: next.id })
  return next
}

/**
 * 로그인한 사람을 알린다(`/me` 를 받은 직후, 탭 줄이 뜨기 전). 다른 사람의 탭이면 홈 탭 하나로 갈아 끼운다.
 * 같은 사람이 세션 만료 뒤 다시 들어온 것이면 그대로 둔다.
 */
export function claimTabs(userId: string) {
  if (!isDesktopShell() || state.owner === userId) return
  commit({ ...single('/'), owner: userId })
}

/** Ctrl·⌘+클릭, 휠 클릭으로 새 탭에 열 앱 안 화면이면 그 경로. 파일·같은 화면 안 이동은 빼고. */
export function inAppTarget(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) return null
  if (!/^https?:$/.test(anchor.protocol) || anchor.origin !== window.location.origin) return null
  if (anchor.pathname.startsWith('/api/')) return null
  if (anchor.hash && anchor.pathname === window.location.pathname) return null
  return anchor.pathname + anchor.search
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDesktopTabs(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/** 테스트용: 저장소를 다시 읽는다. */
export function resetDesktopTabs() {
  state = load()
}
