import { useEffect, useRef, type TouchEvent } from 'react'

/** 이만큼 누르고 있으면 꾹 누른 것. 안드로이드가 길게 누르기로 우클릭을 보내는 시간과 비슷하다. */
const HOLD_MS = 500
/** 누르는 동안 손가락이 이보다 움직이면 스크롤로 보고 접는다(px). */
const SLOP = 10
/** 줄이 눌려 들어가기 시작하는 때. 스크롤은 보통 이 안에 SLOP 을 넘어 접히므로 줄이 깜빡이지 않는다. */
const SINK_DELAY_MS = 120

type Press = {
  x: number
  y: number
  timer: number
  fired: boolean
  /** 눌려 들어가는 요소(`data-long-press`)와 그 애니메이션. */
  lift: HTMLElement | null
  sink: Animation | null
}

/**
 * 짧은 진동. 안드로이드는 vibrate 로 된다. 아이폰 사파리에는 vibrate 가 없어서, iOS 18 부터
 * 스위치 체크박스를 토글하면 나는 진동을 빌린다. 사파리가 이 길을 막으면 조용히 아무 일도 없다.
 */
function haptic() {
  if ('vibrate' in navigator && navigator.vibrate(10)) return
  const label = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  label.append(input)
  label.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.append(label)
  label.click()
  label.remove()
}

/** 눌려 들어간 자리에서 `to` 로 돌아간다. 끊으면 제자리로 튀므로 지금 모양에서 이어 간다. */
function release(p: Press, to: Keyframe[], duration: number) {
  if (!p.lift || !p.sink) return
  const from = getComputedStyle(p.lift).transform
  p.sink.cancel()
  p.sink = null
  p.lift.animate([{ transform: from }, ...to], { duration, easing: 'ease-out' })
}

/**
 * 손가락으로 꾹 누르기. 부르는 쪽 영역에 핸들러를 펼쳐 단다.
 *
 * 안드로이드 크롬은 길게 누르면 contextmenu 를 보내지만 아이폰 사파리는 보내지 않아 직접 잰다.
 * 둘 다 오면 `onPress` 가 두 번 불리므로 같은 자리를 다시 여는 동작이어야 한다.
 * `onPress` 가 true 를 돌려주면(무언가 열었으면) 진동을 주고, 손을 뗄 때 따라오는 클릭을 막는다.
 * 안 막으면 메뉴가 뜬 뒤 그 줄의 링크가 열린다.
 *
 * 누른 자리를 품은 `data-long-press` 요소는 iOS 처럼 누르는 동안 살짝 눌려 들어갔다가, 열리면
 * 튕기며 돌아오고 접히면 그냥 돌아온다.
 */
export function useLongPress(onPress: (target: Element, x: number, y: number) => boolean) {
  const press = useRef<Press | null>(null)

  const stop = () => {
    const p = press.current
    if (!p) return
    clearTimeout(p.timer)
    release(p, [{ transform: 'none' }], 150)
    press.current = null
  }
  useEffect(() => stop, [])

  return {
    onTouchStart: (e: TouchEvent) => {
      stop()
      const target = e.target
      if (e.touches.length !== 1 || !(target instanceof Element)) return
      const { clientX: x, clientY: y } = e.touches[0]
      const lift = target.closest<HTMLElement>('[data-long-press]')
      const p: Press = {
        x,
        y,
        fired: false,
        timer: 0,
        lift,
        sink:
          lift && !matchMedia('(prefers-reduced-motion: reduce)').matches
            ? lift.animate([{ transform: 'none' }, { transform: 'scale(0.96)' }], {
                delay: SINK_DELAY_MS,
                duration: HOLD_MS - SINK_DELAY_MS,
                easing: 'ease-out',
                fill: 'forwards',
              })
            : null,
      }
      p.timer = window.setTimeout(() => {
        p.fired = onPress(target, x, y)
        if (!p.fired) return
        // 메뉴가 그려지기 전에 울린다. 진동용 체크박스가 메뉴에서 초점을 뺏으면 메뉴가 닫힌다.
        haptic()
        release(p, [{ transform: 'scale(1.02)', offset: 0.5 }, { transform: 'none' }], 250)
      }, HOLD_MS)
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
