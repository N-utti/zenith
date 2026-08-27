import { useSyncExternalStore } from 'react'

/**
 * 흐르는 시계. 벽시계는 React 밖의 가변 소스이므로 useSyncExternalStore로 구독한다.
 * (렌더 중 Date.now()를 직접 부르면 순수성 규칙 위반이다.)
 *
 * 구독자가 있을 때만 타이머가 돌고, 마지막 구독자가 떠나면 정리된다.
 */
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  timer ??= setInterval(() => listeners.forEach((fn) => fn()), 60_000)

  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** 분 단위로만 바뀌는 스냅샷 — 초가 흘러도 불필요한 리렌더가 생기지 않는다. */
function getSnapshot() {
  return Math.floor(Date.now() / 60_000)
}

/** 현재 시각(분 단위 epoch). 1분마다 갱신된다. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
