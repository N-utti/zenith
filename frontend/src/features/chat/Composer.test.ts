import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { ChatSocketContext } from './ChatSocketContext'
import { Composer } from './Composer'
import { getDraft } from './drafts'
import type { ChatSocket } from './useChatSocket'

// @ 자동완성은 동료 목록 쿼리를 부른다. 여기서 보는 건 입력값이 어디 남느냐뿐이라 맨 textarea 로 바꾼다.
vi.mock('@/features/people/MentionTextarea', () => ({
  MentionTextarea: ({
    value,
    onValueChange,
  }: {
    value: string
    onValueChange: (next: string) => void
  }) =>
    createElement('textarea', {
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onValueChange(e.target.value),
    }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sendMessage = vi.fn(() => true)
const socket = { connected: true, sendMessage } as unknown as ChatSocket

function type(container: HTMLElement, text: string) {
  const box = container.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

test('다른 방에 다녀와도 쓰던 글이 남고, 보내면 사라진다', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const show = (id: string) =>
    act(() =>
      root.render(
        createElement(
          ChatSocketContext,
          { value: socket },
          createElement(Composer, {
            key: id,
            channelId: id,
            channelName: id,
            hash: true,
            mentionCandidates: [],
            onTyping: () => {},
          }),
        ),
      ),
    )
  const box = () => container.querySelector('textarea')!.value

  show('a')
  act(() => type(container, '회의 몇 시'))
  show('b')
  expect(box()).toBe('')
  show('a')
  expect(box()).toBe('회의 몇 시')

  // 끊겨서 못 보내면 글도 초안도 그대로다.
  sendMessage.mockReturnValueOnce(false)
  act(() => container.querySelector('form')!.requestSubmit())
  expect(box()).toBe('회의 몇 시')
  expect(getDraft('a')).toBe('회의 몇 시')

  act(() => container.querySelector('form')!.requestSubmit())
  expect(sendMessage).toHaveBeenLastCalledWith('a', {
    body: '회의 몇 시',
    attachments: undefined,
  })
  expect(getDraft('a')).toBe('')
  act(() => root.unmount())
})
