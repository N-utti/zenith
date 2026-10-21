import { useEffect, useRef, type TouchEvent } from 'react'

/** 이만큼 누르고 있으면 꾹 누른 것. 안드로이드가 길게 누르기로 우클릭을 보내는 시간과 비슷하다. */
const HOLD_MS = 500
/** 누르는 동안 손가락이 이보다 움직이면 스크롤로 보고 접는다(px). */
const SLOP = 10

/**
 * 손가락으로 꾹 누르기. 부르는 쪽 영역에 핸들러를 펼쳐 단다.
 *
 * 안드로이드 크롬은 길게 누르면 contextmenu 를 보내지만 아이폰 사파리는 보내지 않아 직접 잰다.
 * 둘 다 오면 `onPress` 가 두 번 불리므로 같은 자리를 다시 여는 동작이어야 한다.
 * `onPress` 가 true 를 돌려주면(무언가 열었으면) 손을 뗄 때 따라오는 클릭을 막는다. 안 막으면
 * 메뉴가 뜬 뒤 그 줄의 링크가 열린다.
 */
export function useLongPress(onPress: (target: Element, x: number, y: number) => boolean) {
  const press = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null)

  const stop = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => stop, [])

  return {
    onTouchStart: (e: TouchEvent) => {
      stop()
      const target = e.target
      if (e.touches.length !== 1 || !(target instanceof Element)) return
      const { clientX: x, clientY: y } = e.touches[0]
      const p = { x, y, fired: false, timer: 0 }
      p.timer = window.setTimeout(() => (p.fired = onPress(target, x, y)), HOLD_MS)
      press.current = p
    },
    onTouchMove: (e: TouchEvent) => {
      const p = press.current
      const t = e.touches[0]
      if (p && !p.fired && Math.hypot(t.clientX - p.x, t.clientY - p.y) > SLOP) stop()
    },
    onTouchEnd: (e: TouchEvent) => {
      if (press.current?.fired) e.preventDefault()
      stop()
    },
    onTouchCancel: stop,
  }
}
