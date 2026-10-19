/** 좁은 폭에서 본문 아래로 내려온 문서 패널(DocWorkspace 의 DocSidebar) 계산. 화면 없이 시험하려고 뺐다. */

export type SheetStop = 'closed' | 'half' | 'full'

const STOP_ORDER: SheetStop[] = ['closed', 'half', 'full']
/** 이보다 빠르게(px/ms) 놓으면 튕긴 것으로 본다. */
const FLICK_SPEED = 0.5
/** 놓을 때 속도를 재는 구간(ms). */
const FLICK_WINDOW_MS = 100
/** 마지막 움직임 뒤 이만큼 멈췄다 놓으면 튕긴 게 아니다(자리를 맞추고 놓는 손짓). */
const FLICK_PAUSE_MS = 40

/**
 * 놓을 때의 속도(위로 +, px/ms). samples 는 끄는 동안의 손가락 자리, now 는 놓은 시각.
 * 표본은 손가락이 움직일 때만 쌓여서, 멈춰 있던 시간은 따로 봐야 한다.
 */
export function releaseSpeed(samples: { y: number; t: number }[], now: number) {
  const recent = samples.filter((s) => now - s.t < FLICK_WINDOW_MS)
  const first = recent[0]
  const last = recent.at(-1)
  if (!first || !last || last.t === first.t || now - last.t > FLICK_PAUSE_MS) return 0
  return (first.y - last.y) / (last.t - first.t)
}

/**
 * 손가락으로 끌다 놓은 높이(h, px)와 속도(v, 위로 +, px/ms)로 갈 단계를 고른다. stops 는 단계마다의 높이,
 * from 은 끌기를 시작한 높이. 빠르게 튕겼으면 그 방향의 다음 단계, 아니면 가장 가까운 단계로 간다.
 * 다음 단계는 시작한 자리와 놓은 자리 중 그 방향으로 더 간 쪽에서 센다. 원래 높이에서 살짝 올렸다가
 * 아래로 튕기면 원래 높이로 돌아가지 않고 접힌다.
 */
export function sheetStop(
  h: number,
  v: number,
  stops: Record<SheetStop, number>,
  from: number,
): SheetStop {
  if (v > FLICK_SPEED) {
    const base = Math.max(h, from)
    return STOP_ORDER.find((s) => stops[s] > base + 1) ?? 'full'
  }
  if (v < -FLICK_SPEED) {
    const base = Math.min(h, from)
    return [...STOP_ORDER].reverse().find((s) => stops[s] < base - 1) ?? 'closed'
  }
  return STOP_ORDER.reduce((best, s) =>
    Math.abs(stops[s] - h) < Math.abs(stops[best] - h) ? s : best,
  )
}

type Scroller = { scrollTop: number; scrollHeight: number; clientHeight: number }

/**
 * 다 펼친 패널에서 첫 터치 움직임(dx, dy)을 어디에 줄지. scroller 는 손가락 아래에서 실제로 굴러가는 칸.
 * scroll 은 브라우저에 맡기고, sheet 는 시트를 끌고, block 은 그냥 막는다. 굴러갈 데가 없는 방향을 막지
 * 않으면 손짓이 바깥으로 넘어가 아이폰에서 화면 전체가 튕긴다.
 */
export function touchIntent(
  dx: number,
  dy: number,
  scroller: Scroller | null,
): 'scroll' | 'sheet' | 'block' {
  // 가로(코드 블록 가로 스크롤)는 브라우저에 맡긴다.
  if (Math.abs(dx) > Math.abs(dy)) return 'scroll'
  if (dy > 0) return scroller && scroller.scrollTop > 0 ? 'scroll' : 'sheet'
  const room = scroller && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
  return room ? 'scroll' : 'block'
}

/** 탭 줄과 AI 질문 입력칸(약 170px) 위로 기록이 한두 줄 보이는 높이. */
const PANEL_HEIGHT_MIN_PX = 220
/** 패널을 키워도 남기는 본문 높이(서식 툴바와 두세 줄). 이보다 작으면 블록 가기·미리보기가 안 보인다. */
const BODY_MIN_PX = 120

/** 손가락 기기의 원래 높이(본문 칸에 대한 비율). 클래스 h-[45%] 와 맞춘다. */
export const HALF_RATIO = 0.45
/**
 * 손가락 기기의 원래 높이 하한(px). 탭 줄(약 60px)과 AI 질문 입력칸·보내기 버튼(약 130px)이 다 들어가고
 * 기록이 한두 줄 보이는 높이. 작은 아이폰에서는 45% 가 200px 남짓이라 보내기 버튼이 잘렸다.
 * 263 은 AI 질문·팩트체크 탭(아래 영역 143px)의 빈 화면 안내 두 줄이 위아래 여백 12px 와 함께 들어가는 높이.
 * 두 이유 중 이쪽이 더 높아 하한을 정한다.
 */
const HALF_MIN_PX = 263

/**
 * 손가락 기기의 원래 높이(px). box 는 칸 높이, head 는 머리(막대 + 탭 줄) 높이. 45% 와 263px 중 큰 쪽이되
 * 본문은 120px 남긴다. 남기지 않으면 낮은 칸(폰 가로 모드)에서 원래 높이가 다 펼침과 같아져, 본문이
 * 사라졌는데도 원래 높이 상태라 목록이 안 굴러가고 블록 가기도 본문을 못 드러낸다. 그런 칸에서는
 * 입력칸이 조금 잘리고, 다 펼쳐서 쓴다. 클래스 min-h-[min(263px,calc(100%-120px))] 와 맞춘다.
 */
export function halfHeight(box: number, head: number) {
  const floor = Math.min(HALF_MIN_PX, box - BODY_MIN_PX)
  return Math.min(Math.max(box * HALF_RATIO, floor, head + 1), box)
}

/**
 * PC 에서 끌어 고른 패널 높이(본문 칸에 대한 %)를 범위 안으로. 최소·최대는 px 로 지키므로 지금 칸
 * 높이(total)로 % 를 바꿔 잰다. 칸이 아주 작아 둘이 겹치면 최소가 이긴다(입력칸이 잘리지 않게).
 * 끄는 동안 칸이 뚝뚝 끊기지 않게 소수 첫째 자리까지 남긴다.
 */
export function clampPanelHeight(pct: number, total: number) {
  const min = (PANEL_HEIGHT_MIN_PX / total) * 100
  const max = Math.max(100 - (BODY_MIN_PX / total) * 100, min)
  return Math.round(Math.min(Math.max(pct, min), max, 100) * 10) / 10
}
