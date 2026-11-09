import { Editor } from '@tiptap/core'
import { UndoRedo } from '@tiptap/extensions'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { docContentExtensions } from './editorExtensions'

// 마우스로 끄는 동안은 선택 막대를 띄우지 않고, 버튼을 뗐을 때 최종 선택 자리에 한 번 띄운다.

// jsdom 은 배치를 계산하지 않아 막대의 자리 계산(floating-ui)이 부르는 함수가 없다. 빈 값을 돌려준다.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
})
let root: Root | undefined
let editor: Editor | undefined
afterEach(() => {
  act(() => root?.unmount())
  editor?.destroy()
  document.body.replaceChildren()
})

/** jsdom 에는 PointerEvent 가 없다. 막대는 pointerType·button 만 본다. */
const pointer = (type: string, pointerType = 'mouse') => {
  const event = new MouseEvent(type, { bubbles: true, button: 0 })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const shown = () => !!document.querySelector('button[aria-label="블록 지우기"]')?.isConnected

function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  editor = new Editor({
    element: host,
    // 막대가 보는 툴바 상태는 되돌리기 명령을 묻는다. 실제 화면에서는 협업 확장이 준다.
    extensions: [...docContentExtensions(), UndoRedo],
    content: '<p>흩어진 업무 대화와 문서</p>',
  })
  const mountPoint = document.createElement('div')
  document.body.append(mountPoint)
  root = createRoot(mountPoint)
  act(() => root!.render(createElement(EditorBubbleMenu, { editor: editor! })))
  return editor
}

it('누르고 끄는 동안은 뜨지 않고, 떼면 뜬다', async () => {
  const e = mount()
  e.view.dom.dispatchEvent(pointer('pointerdown'))
  act(() => void e.commands.setTextSelection({ from: 1, to: 4 }))
  await wait(150)
  act(() => void e.commands.setTextSelection({ from: 1, to: 8 }))
  await wait(150)
  expect(shown()).toBe(false)

  window.dispatchEvent(pointer('pointerup'))
  await wait(50)
  expect(shown()).toBe(true)
})

it('키보드·손가락으로 고르면 예전처럼 바로 뜬다. 선택이 없으면 떼도 뜨지 않는다', async () => {
  const e = mount()
  act(() => void e.commands.setTextSelection({ from: 1, to: 4 }))
  await wait(150)
  expect(shown()).toBe(true)

  act(() => void e.commands.setTextSelection(2))
  await wait(150)
  expect(shown()).toBe(false)
  e.view.dom.dispatchEvent(pointer('pointerdown'))
  window.dispatchEvent(pointer('pointerup'))
  await wait(50)
  expect(shown()).toBe(false)

  e.view.dom.dispatchEvent(pointer('pointerdown', 'touch'))
  act(() => void e.commands.setTextSelection({ from: 1, to: 4 }))
  await wait(150)
  expect(shown()).toBe(true)
})

it('끌어 옮기기·창 전환으로 뗀 신호가 안 와도 붙잡힌 채로 남지 않는다', async () => {
  const e = mount()
  for (const [target, type] of [
    [window, 'pointercancel'],
    [window, 'blur'],
    [e.view.dom, 'dragstart'],
  ] as const) {
    act(() => void e.commands.setTextSelection(2))
    await wait(150)
    e.view.dom.dispatchEvent(pointer('pointerdown'))
    target.dispatchEvent(new Event(type))
    act(() => void e.commands.setTextSelection({ from: 1, to: 4 }))
    await wait(150)
    expect(shown(), type).toBe(true)
  }
})
