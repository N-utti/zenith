import { useState } from 'react'

/** 범위 안으로. 창 폭 비율(vw)도 상한이라 좁은 창에서 패널끼리 본문을 다 먹지 않는다. */
export function clampWidth(w: number, min: number, max: number, vw: number) {
  return Math.round(Math.max(Math.min(w, max, window.innerWidth * vw), min))
}

/** 저장값을 읽는다. 없거나 숫자가 아니거나 저장소를 못 열면 기본값. */
export function readPanelWidth(key: string, initial: number, min: number, max: number, vw: number) {
  try {
    const saved = Number(localStorage.getItem(key))
    return saved ? clampWidth(saved, min, max, vw) : initial
  } catch {
    return initial
  }
}

/**
 * 끌어서 바꾼 패널 폭. 모니터마다 달라 서버가 아니라 이 브라우저에만 남긴다(본문 폭과 같다).
 * maxWidth 는 불러온 뒤 창을 줄였을 때의 상한이다. 패널 style 에 width 와 같이 건다.
 */
export function usePanelWidth(key: string, initial: number, min: number, max: number, vw: number) {
  const [width, setWidth] = useState(() => readPanelWidth(key, initial, min, max, vw))
  const set = (w: number) => {
    const next = clampWidth(w, min, max, vw)
    setWidth(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      // 저장 못 해도 이번 세션의 폭은 유지된다.
    }
  }
  // 기본값을 저장해 두지 않는다. 나중에 기본 폭을 바꾸면 그대로 따라가게.
  const reset = () => {
    setWidth(initial)
    try {
      localStorage.removeItem(key)
    } catch {
      // 저장소를 못 열면 지울 것도 없다.
    }
  }
  return { width, maxWidth: `${vw * 100}vw`, set, reset, min, max }
}
