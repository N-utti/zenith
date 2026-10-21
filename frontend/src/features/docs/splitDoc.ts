import { useSyncExternalStore } from 'react'

/**
 * 화면을 나눠 오른쪽에 띄운 문서. 닫기 전까지 화면을 옮겨도 남는다(사용자 결정). 채팅 채널을 옮겨 다니며 같은
 * 문서를 볼 수 있다. AppLayout 은 bleed 유무로 두 벌이라 화면을 옮길 때 다시 마운트돼 컴포넌트 상태로는 못 든다.
 * 새로 고쳐도 남게 이 탭의 저장소(sessionStorage)에 둔다. 다른 탭에는 번지지 않는다.
 */
const KEY = 'zenith.splitDoc'

function read() {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

let current = read()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSplitDoc(id: string | null) {
  current = id
  try {
    if (id) sessionStorage.setItem(KEY, id)
    else sessionStorage.removeItem(KEY)
  } catch {
    // 저장 못 해도 이 화면에서는 남는다.
  }
  listeners.forEach((listener) => listener())
}

export function useSplitDoc() {
  return useSyncExternalStore(subscribe, () => current)
}
