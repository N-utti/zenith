import { useSyncExternalStore } from 'react'

/**
 * 홈의 "제니스 시작하기" 진행 상태. 할 일이 실제로 끝나는 자리(비밀번호 변경·설정 저장·메시지 전송·
 * AI 질문)가 `markOnboarding` 을 부른다.
 *
 * ponytail: 서버 환경설정은 모르는 키를 422 로 막아 이 브라우저에만 둔다. 다른 기기에서는 처음부터
 * 다시 뜨고, 닫으면 그 기기에서만 사라진다. 기기를 넘어 이어야 하면 `/me/preferences` 에 칸을 받는다.
 * 같은 브라우저를 다른 사람이 쓸 수 있어 키에 사용자 id 를 넣는다.
 */
export type OnboardingStep = 'password' | 'preferences' | 'chat' | 'ai'

export interface OnboardingState {
  done: OnboardingStep[]
  dismissed: boolean
}

const keyOf = (userId: string) => `zenith.onboarding.${userId}`
const listeners = new Set<() => void>()

let owner: string | null = null
/** 주인이 없으면(로그인 전) null. 구독 값이라 바뀔 때만 새 객체로 바꾼다. */
let current: OnboardingState | null = null

function read(userId: string): OnboardingState {
  try {
    const saved = JSON.parse(
      localStorage.getItem(keyOf(userId)) ?? 'null',
    ) as OnboardingState | null
    if (saved && Array.isArray(saved.done)) return saved
  } catch {
    // 깨진 값이나 막힌 저장소는 처음 온 것으로 친다.
  }
  return { done: [], dismissed: false }
}

function write(next: OnboardingState) {
  current = next
  try {
    if (owner) localStorage.setItem(keyOf(owner), JSON.stringify(next))
  } catch {
    // 저장 못 해도 이번 세션 동안은 화면이 맞다.
  }
  listeners.forEach((fn) => fn())
}

/** 로그인한 사람이 바뀔 때 부른다(`AuthProvider`). 로그아웃은 null. */
export function setOnboardingOwner(userId: string | null) {
  if (userId === owner) return
  owner = userId
  current = userId ? read(userId) : null
  listeners.forEach((fn) => fn())
}

// 다른 탭이 그사이 저장했을 수 있어 고치기 전에 다시 읽는다. 안 그러면 낡은 값으로 덮어쓴다.
export function markOnboarding(step: OnboardingStep) {
  if (!owner) return
  const saved = read(owner)
  if (!saved.done.includes(step)) write({ ...saved, done: [...saved.done, step] })
}

export function dismissOnboarding() {
  if (owner) write({ ...read(owner), dismissed: true })
}

/** 다른 탭에서 체크하거나 닫으면 이 탭의 카드도 따라간다. */
function onStorage(e: StorageEvent) {
  if (!owner || e.key !== keyOf(owner)) return
  current = read(owner)
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function useOnboarding() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
