import { createContext, useEffect, useState } from 'react'

/** 이만큼 끊겨 있어야 띄운다. 소켓은 끊기면 바로 다시 붙으므로 짧은 끊김마다 깜빡이지 않게. */
const GRACE_MS = 5000

/**
 * 오래 끊겼는지. `ChatSocketProvider` 가 판정해 내려준다. AppLayout 은 화면을 옮길 때 다시
 * 마운트되므로 배너가 직접 세면 옮길 때마다 유예가 처음부터 돌고 스크린리더가 다시 읽는다.
 * 제공자는 화면 이동에는 남고 로그아웃하면 사라지니 그 수명이 맞다.
 */
export const ConnectionLostContext = createContext(false)

export function useConnectionLost(connected: boolean): boolean {
  const [lost, setLost] = useState(false)

  useEffect(() => {
    if (connected) return
    const timer = window.setTimeout(() => setLost(true), GRACE_MS)
    return () => {
      window.clearTimeout(timer)
      setLost(false)
    }
  }, [connected])

  return lost
}
