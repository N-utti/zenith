import { useSyncExternalStore } from 'react'

const KEY = 'zenith.contentWide'
const listeners = new Set<() => void>()

function read() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let current = read()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setContentWide(wide: boolean) {
  current = wide
  try {
    localStorage.setItem(KEY, wide ? '1' : '0')
  } catch {
    // 저장 못 해도 이번 세션의 너비는 유지된다.
  }
  listeners.forEach((fn) => fn())
}

/** 본문 최대폭을 풀지 여부. 모니터 크기는 기기마다 달라 서버가 아니라 이 브라우저에만 남긴다(테마와 같다). */
export function useContentWide() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => false,
  )
}
