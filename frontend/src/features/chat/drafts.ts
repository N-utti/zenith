import { useSyncExternalStore } from 'react'

/**
 * 방마다 쓰다 만 글. 입력창은 방을 바꿀 때마다 새로 마운트되므로(`key={channelId}`) 여기 두지
 * 않으면 다른 방에 다녀온 사이에 쓰던 글이 사라진다.
 *
 * ponytail: 모듈 상태라 새로고침이면 사라진다. 새로고침 뒤에도 남겨야 하면 localStorage 로 옮기되,
 * 같은 브라우저를 다른 사람이 쓸 수 있으니 키에 사용자 id 를 넣는다.
 */
const drafts = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDraft(channelId: string): string {
  return drafts.get(channelId) ?? ''
}

/** 공백만 남은 글은 쓰다 만 글로 치지 않는다. 방 목록에 연필이 괜히 남는다. */
export function setDraft(channelId: string, body: string) {
  if (body.trim()) drafts.set(channelId, body)
  else drafts.delete(channelId)
  // 글자마다 알려도 방 목록은 다시 그려지지 않는다. 구독 값이 참/거짓이라 바뀔 때만 그린다.
  for (const listener of listeners) listener()
}

/**
 * 로그인할 때 비운다(`AuthProvider`). 같은 탭에서 다음 사람이 로그인하면 남의 글이 입력창에 뜬다.
 *
 * ponytail: 세션이 끊겨 같은 사람이 다시 로그인해도 비워진다. 만료는 refresh 가 살리므로 드문 경로다.
 * 아쉬우면 주인 id 를 기억해 두고 다른 사람일 때만 비운다.
 */
export function clearDrafts() {
  drafts.clear()
  for (const listener of listeners) listener()
}

export function useHasDraft(channelId: string): boolean {
  return useSyncExternalStore(subscribe, () => drafts.has(channelId))
}
