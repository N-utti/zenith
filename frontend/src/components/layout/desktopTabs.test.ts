import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  activateTab,
  activeTab,
  claimTabs,
  closeTab,
  cycleTab,
  openTab,
  resetDesktopTabs,
  updateActiveTab,
} from './desktopTabs'

const paths = () =>
  JSON.parse(localStorage.getItem('zenith.desktopTabs')!).tabs.map((t: { path: string }) => t.path)

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.__TAURI__
})

beforeEach(() => {
  localStorage.clear()
  resetDesktopTabs()
  updateActiveTab({ path: '/a' })
})

test('새 탭은 지금 탭 바로 오른쪽에 열리고, 고른 경우에만 그 탭으로 옮긴다', () => {
  openTab('/c')
  openTab('/b')
  expect(paths()).toEqual(['/a', '/b', '/c'])
  expect(activeTab().path).toBe('/a')

  const tab = openTab('/d', true)
  expect(activeTab()).toEqual(tab)
  expect(paths()).toEqual(['/a', '/d', '/b', '/c'])
})

test('지금 탭을 닫으면 오른쪽, 맨 끝이면 왼쪽으로 옮긴다. 마지막 하나는 닫지 않는다', () => {
  const b = openTab('/b', true)
  const c = openTab('/c')
  expect(closeTab(b.id)?.path).toBe('/c')
  expect(closeTab(c.id)?.path).toBe('/a')
  expect(closeTab(activeTab().id)).toBeNull()
  expect(paths()).toEqual(['/a'])
})

test('다른 탭을 닫으면 화면은 그대로다', () => {
  const b = openTab('/b')
  expect(closeTab(b.id)).toBeNull()
  expect(activeTab().path).toBe('/a')
})

test('탭마다 주소와 오른쪽 문서를 따로 기억하고, 껐다 켜도 남는다', () => {
  updateActiveTab({ split: 'doc-1' })
  const b = openTab('/b', true)
  expect(b.split).toBeNull()
  updateActiveTab({ path: '/b/2' })

  resetDesktopTabs() // 앱을 다시 켠 셈
  expect(activeTab().path).toBe('/b/2')
  expect(cycleTab(1)).toMatchObject({ path: '/a', split: 'doc-1' })
  expect(cycleTab(-1)?.path).toBe('/b/2')
  expect(activateTab(activeTab().id)).toBeNull()
})

test('저장된 값이 깨졌으면 지금 화면 하나로 시작한다', () => {
  localStorage.setItem('zenith.desktopTabs', '{"tabs":[],"active":"x"}')
  resetDesktopTabs()
  expect(activeTab().path).toBe(location.pathname)
})

test('다른 사람이 로그인하면 앞사람 탭을 버리고, 같은 사람이면 남긴다', () => {
  window.__TAURI__ = { core: { invoke: vi.fn() } }
  claimTabs('a')
  updateActiveTab({ path: '/approvals/9', split: 'doc-1' })
  openTab('/chat/c1')
  claimTabs('a')
  expect(paths()).toEqual(['/approvals/9', '/chat/c1'])

  claimTabs('b')
  expect(paths()).toEqual(['/'])
  expect(activeTab().split).toBeNull()
})

test('보안 연결이 아니어서 randomUUID 가 없어도 탭을 만든다(사내망 평문 주소)', () => {
  const real = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
  expect(openTab('/b').id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/)
})

test('웹(셸 아님)에서는 탭 주인을 적지 않는다', () => {
  claimTabs('a')
  expect(JSON.parse(localStorage.getItem('zenith.desktopTabs')!).owner).toBeUndefined()
})
