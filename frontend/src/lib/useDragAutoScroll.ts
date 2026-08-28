import { useEffect, type RefObject } from 'react'

/** 가장자리에서 자동 스크롤이 걸리기 시작하는 폭(px). */
const EDGE = 72
/** 가장 깊이 들어갔을 때 한 프레임에 움직이는 거리(px). */
const MAX_STEP = 16
/**
 * 끝 신호(drop·dragend)를 놓쳤을 때를 대비한 안전장치.
 * 브라우저는 드래그가 머물러 있어도 dragover를 300ms 안팎으로 계속 쏜다.
 */
const IDLE_STOP_MS = 1200

/**
 * 드래그 중에 포인터가 위아래 끝에 닿으면 그 방향으로 컨테이너를 굴린다.
 *
 * 파일을 바깥에서 끌어올 때든, 이미 있는 블록을 손잡이로 옮길 때든 모두
 * HTML5 드래그라 dragover 하나로 잡힌다. 컨테이너가 아니라 window에서 듣는
 * 이유는, 포인터가 컨테이너 밖(툴바·창 밖)으로 나가면 dragover가 끊겨
 * 스크롤이 멈추지 않고 계속 흐르기 때문이다.
 */
export function useDragAutoScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = ref.current
    if (!container) return

    let frame = 0
    let step = 0
    let lastMove = 0

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      step = 0
    }

    const tick = () => {
      if (performance.now() - lastMove > IDLE_STOP_MS) return stop()
      container.scrollTop += step
      frame = requestAnimationFrame(tick)
    }

    /** 끝에 가까울수록 빨라진다. 경계를 넘어선 만큼은 최대 속도로 친다. */
    const speedFor = (depth: number) => Math.ceil((Math.min(depth, EDGE) / EDGE) * MAX_STEP)

    const onDragOver = (event: DragEvent) => {
      const box = container.getBoundingClientRect()
      const fromTop = event.clientY - box.top
      const fromBottom = box.bottom - event.clientY

      // 반응 구간은 본문 영역을 EDGE만큼 넓힌 데까지다. 이보다 멀리(툴바 위,
      // 창 밖) 나가면 멈춰야 한다 — 안 그러면 손을 떼기 전까지 계속 흐른다.
      const inRange =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        fromTop > -EDGE &&
        fromBottom > -EDGE

      if (!inRange) return stop()

      if (fromTop < EDGE) step = -speedFor(EDGE - fromTop)
      else if (fromBottom < EDGE) step = speedFor(EDGE - fromBottom)
      else return stop()

      lastMove = performance.now()
      if (!frame) frame = requestAnimationFrame(tick)
    }

    // 창 밖으로 나간 드래그는 relatedTarget이 비어 온다.
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) stop()
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', stop)
    window.addEventListener('dragend', stop)

    return () => {
      stop()
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', stop)
      window.removeEventListener('dragend', stop)
    }
  }, [ref])
}
