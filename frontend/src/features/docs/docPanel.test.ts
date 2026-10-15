import { describe, expect, it } from 'vitest'
import { clampPanelHeight, halfHeight, releaseSpeed, sheetStop, touchIntent } from './docPanel'

describe('sheetStop', () => {
  const stops = { closed: 60, half: 225, full: 500 }

  it('천천히 놓으면 가장 가까운 단계로 간다(0.5px/ms 까지는 튕김이 아니다)', () => {
    expect(sheetStop(100, 0, stops, 60)).toBe('closed')
    expect(sheetStop(180, 0, stops, 60)).toBe('half')
    expect(sheetStop(400, 0.5, stops, 225)).toBe('full')
  })

  it('빠르게 튕기면 그 방향의 다음 단계로 간다', () => {
    expect(sheetStop(100, 1, stops, 60)).toBe('half')
    expect(sheetStop(230, 1, stops, 225)).toBe('full')
    expect(sheetStop(480, -1, stops, 500)).toBe('half')
    expect(sheetStop(200, -1, stops, 225)).toBe('closed')
  })

  it('놓은 높이가 단계와 같아도 튕긴 방향으로 넘어간다', () => {
    expect(sheetStop(225, 1, stops, 225)).toBe('full')
    expect(sheetStop(225, -1, stops, 225)).toBe('closed')
  })

  it('시작한 단계에서 반대로 살짝 끌었다 튕기면 시작한 단계의 다음으로 간다', () => {
    expect(sheetStop(240, -1, stops, 225)).toBe('closed')
    expect(sheetStop(210, 1, stops, 225)).toBe('full')
  })
})

describe('releaseSpeed', () => {
  it('최근 움직임으로 위쪽 속도를 잰다', () => {
    const samples = [
      { y: 300, t: 0 },
      { y: 280, t: 10 },
      { y: 260, t: 20 },
    ]
    expect(releaseSpeed(samples, 25)).toBe(2)
  })

  it('빠르게 끌다 멈췄다 놓으면 튕긴 게 아니다', () => {
    const samples = [
      { y: 300, t: 0 },
      { y: 260, t: 32 },
    ]
    expect(releaseSpeed(samples, 92)).toBe(0)
  })
})

describe('touchIntent', () => {
  const list = (scrollTop: number) => ({ scrollTop, scrollHeight: 600, clientHeight: 300 })

  it('아래로 당기면 맨 위일 때만 시트를 끌고, 굴려 둔 목록은 굴린다', () => {
    expect(touchIntent(0, 10, list(0))).toBe('sheet')
    expect(touchIntent(0, 10, null)).toBe('sheet')
    expect(touchIntent(0, 10, list(120))).toBe('scroll')
  })

  it('위로 밀 때 더 굴러갈 데가 없으면 막는다(화면 전체가 튕기지 않게)', () => {
    expect(touchIntent(0, -10, list(0))).toBe('scroll')
    expect(touchIntent(0, -10, list(300))).toBe('block')
    expect(touchIntent(0, -10, null)).toBe('block')
  })

  it('가로 손짓은 브라우저에 맡긴다', () => {
    expect(touchIntent(-12, 3, null)).toBe('scroll')
  })
})

describe('halfHeight', () => {
  it('넉넉한 칸에서는 45% 다', () => {
    expect(halfHeight(700, 58)).toBe(315)
  })

  it('작은 칸에서는 240px 까지 올리되 본문을 120px 남긴다', () => {
    expect(halfHeight(460, 58)).toBe(240)
    expect(halfHeight(300, 58)).toBe(180)
  })

  it('아주 낮은 칸에서도 다 펼침(칸 전체)과 같아지지 않고, 머리보다 작아지지도 않는다', () => {
    expect(halfHeight(200, 58)).toBe(90)
    expect(halfHeight(150, 58)).toBe(67.5)
    expect(halfHeight(100, 58)).toBe(59)
  })
})

describe('clampPanelHeight', () => {
  it('최소는 칸 높이와 상관없이 220px 이다', () => {
    expect(clampPanelHeight(10, 550)).toBe(40)
    expect(clampPanelHeight(10, 1100)).toBe(20)
  })

  it('끝까지 키워도 본문을 120px 남기고, 칸이 아주 작으면 최소가 이긴다', () => {
    expect(clampPanelHeight(130, 600)).toBe(80)
    expect(clampPanelHeight(90, 300)).toBe(73.3)
    expect(clampPanelHeight(50, 180)).toBe(100)
  })

  it('소수 첫째 자리까지 남긴다', () => {
    expect(clampPanelHeight(61.234, 546)).toBe(61.2)
  })
})
