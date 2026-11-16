import { useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * 잠금 모드(카톡 PC 잠금모드처럼). 4자리 번호, 자리 비움 자동 잠금 시간, 지금 잠겼는지를
 * 이 브라우저에 사람별로 둔다. 잠긴 채 새로 고쳐도 잠긴 채로 뜨고, 탭 하나가 잠그면 다른 탭도 잠긴다.
 *
 * ponytail: 자리 비운 사이 옆 사람이 화면을 못 보게 가리는 막이지 보안 경계가 아니다. 번호는 평문으로
 * 브라우저 저장소에 있고 개발자 도구를 열 줄 알면 지울 수 있다(데이터는 여전히 서버가 세션으로 지킨다).
 * 막이 아니라 잠금이어야 하면 계정 비밀번호 확인 API(백엔드)를 붙여 그걸로 푼다.
 */
export interface AppLock {
  pin: string
  /** 0 이면 자동으로 잠그지 않는다. */
  idleMinutes: number
  locked: boolean
}

export const IDLE_OPTIONS = [
  { value: '0', label: '사용 안 함' },
  { value: '5', label: '5분' },
  { value: '10', label: '10분' },
  { value: '30', label: '30분' },
  { value: '60', label: '1시간' },
]

export const isPin = (v: string) => /^\d{4}$/.test(v)

const key = (userId: string) => `zenith.appLock.${userId}`
/** 마지막으로 손댄 시각. 탭끼리 나눠 본다. 한 탭에서 일하는 동안 다른 탭이 자리 비움으로 잠그지 않게. */
const ACTIVE_KEY = 'zenith.lastActive'

const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  // 다른 탭이 바꾼 것은 storage 이벤트로 온다(바꾼 탭 자신에게는 오지 않는다).
  window.addEventListener('storage', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', fn)
  }
}

function readRaw(userId: string) {
  try {
    return localStorage.getItem(key(userId))
  } catch {
    return null
  }
}

function parse(raw: string | null): AppLock | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as AppLock
    return isPin(v?.pin) ? v : null
  } catch {
    return null
  }
}

export const readAppLock = (userId: string) => parse(readRaw(userId))

/** null 이면 잠금 모드를 끈다. */
export function setAppLock(userId: string, lock: AppLock | null) {
  try {
    if (lock) localStorage.setItem(key(userId), JSON.stringify(lock))
    else localStorage.removeItem(key(userId))
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 잠금 모드가 켜지지 않는다.
  }
  listeners.forEach((fn) => fn())
}

export function lockNow(userId: string) {
  const lock = readAppLock(userId)
  if (lock && !lock.locked) setAppLock(userId, { ...lock, locked: true })
}

/** 번호가 맞으면 풀고 true. */
export function unlockAppLock(userId: string, pin: string) {
  const lock = readAppLock(userId)
  if (!lock || lock.pin !== pin) return false
  markActive(true)
  setAppLock(userId, { ...lock, locked: false })
  return true
}

/** 문자열 그대로 비교해야 매번 새 객체가 나와도 다시 그리지 않는다. 풀어 읽기는 바뀔 때만. */
export function useAppLock(userId: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(userId),
    () => null,
  )
  return useMemo(() => parse(raw), [raw])
}

let lastActive = Date.now()
let lastShared = 0

function markActive(force = false) {
  lastActive = Date.now()
  // 마우스를 움직일 때마다 쓰면 저장소가 바쁘다. 다른 탭에는 5초마다만 알린다.
  if (!force && lastActive - lastShared < 5000) return
  lastShared = lastActive
  try {
    localStorage.setItem(ACTIVE_KEY, String(lastActive))
  } catch {
    // 못 나누면 탭마다 따로 센다.
  }
}

const onActivity = () => markActive()

function lastActiveAnywhere() {
  try {
    return Math.max(lastActive, Number(localStorage.getItem(ACTIVE_KEY)) || 0)
  } catch {
    return lastActive
  }
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

/**
 * 정한 시간 동안 어느 탭에서도 손대지 않으면 잠근다. 시계로 비교하니 컴퓨터가 잠들었다 깨어나도
 * 다음 확인(10초 안)에 바로 잠긴다.
 */
export function useAutoLock(userId: string, lock: AppLock | null) {
  const minutes = lock && !lock.locked ? lock.idleMinutes : 0
  useEffect(() => {
    if (!minutes) return
    // 꺼져 있던 동안은 손댄 시각을 세지 않았다. 켜는(시간을 바꾸는) 지금을 손댄 때로 친다.
    // 안 그러면 앱을 오래 쓰다 켠 순간 마지막 손댐이 한참 전이라 첫 확인에서 바로 잠긴다.
    markActive(true)
    // 잡는 단계에서 본다. 편집기처럼 이벤트를 삼키는 곳에서 일해도 손댄 것으로 친다.
    for (const e of ACTIVITY_EVENTS)
      window.addEventListener(e, onActivity, { capture: true, passive: true })
    const timer = setInterval(() => {
      if (Date.now() - lastActiveAnywhere() >= minutes * 60_000) lockNow(userId)
    }, 10_000)
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true })
      clearInterval(timer)
    }
  }, [userId, minutes])
}
