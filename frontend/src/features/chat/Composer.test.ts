import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, test, vi } from 'vitest'
import { ChatSocketContext } from './ChatSocketContext'
import { Composer } from './Composer'
import { getDraft } from './drafts'
import type { ChatSocket } from './useChatSocket'

// 문서 카드는 문서 상세를 조회한다. d-gone 은 못 보는 문서, d-trash 는 휴지통, d-wait 은 아직 조회 중이다.
vi.mock('@/features/docs/api', async (original) => ({
  ...(await original<typeof import('@/features/docs/api')>()),
  useDoc: (id: string) => {
    if (id === 'd-gone') return { data: undefined, isPending: false, isError: true }
    if (id === 'd-wait') return { data: undefined, isPending: true, isError: false }
    const deleted_at = id === 'd-trash' ? '2026-10-27T00:00:00Z' : null
    return {
      data: { title: '3분기 계획', updated_at: '2026-10-27T00:00:00Z', deleted_at },
      isPending: false,
      isError: false,
    }
  },
}))

// @ 자동완성은 동료 목록 쿼리를 부른다. 여기서 보는 건 입력값이 어디 남느냐뿐이라 맨 textarea 로 바꾼다.
vi.mock('@/features/people/MentionTextarea', () => ({
  MentionTextarea: ({
    value,
    onValueChange,
    onKeyDown,
  }: {
    value: string
    onValueChange: (next: string) => void
    onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
  }) =>
    createElement('textarea', {
      value,
      onKeyDown,
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

test('파일을 붙여 넣거나 창에 끌어 놓으면 첨부로 올라가고, 글이 같이 든 붙여넣기는 글로 둔다', async () => {
  const upload = vi
    .spyOn(await import('./api'), 'uploadAttachment')
    .mockImplementation((_channel, file) =>
      Promise.resolve({
        url: `/f/${file.name}`,
        name: file.name,
        size: file.size,
        content_type: null,
      }),
    )
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        ChatSocketContext,
        { value: socket },
        createElement(Composer, {
          channelId: 'a',
          channelName: 'a',
          hash: true,
          mentionCandidates: [],
          onTyping: () => {},
        }),
      ),
    ),
  )
  const carry = (type: string, key: string, name: string, types: string[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, key, {
      value: { files: [new File(['x'], name)], types, getData: () => '' },
    })
    return event
  }

  const pasted = carry('paste', 'clipboardData', '캡처.png', ['Files'])
  await act(async () => void container.querySelector('textarea')!.dispatchEvent(pasted))
  expect(pasted.defaultPrevented).toBe(true)
  // 사진은 이름이 아니라 작은 그림으로 보인다.
  // 파일 읽기는 올리기가 끝난 뒤 따로 돈다. 그 사이의 상태 변경까지 act 안에서 받는다.
  await act(() => new Promise((done) => setTimeout(done, 50)))
  const preview = container.querySelector('img')!
  expect(preview.alt).toBe('캡처.png')
  // 서버 주소가 아니라 고른 파일을 읽은 것이다. 서버는 안 보낸 파일을 내주지 않는다.
  expect(preview.src.startsWith('data:')).toBe(true)

  const cells = carry('paste', 'clipboardData', '표.png', ['text/plain', 'Files'])
  await act(async () => void container.querySelector('textarea')!.dispatchEvent(cells))
  expect(cells.defaultPrevented).toBe(false)

  await act(
    async () => void window.dispatchEvent(carry('drop', 'dataTransfer', '보고서.pdf', ['Files'])),
  )
  expect(container.textContent).toContain('보고서.pdf')
  expect(upload).toHaveBeenCalledTimes(2)

  // 대화 속 그림처럼 화면 안에서 끌기 시작한 것은 놓아도 올리지 않는다.
  window.dispatchEvent(new Event('dragstart'))
  await act(
    async () => void window.dispatchEvent(carry('drop', 'dataTransfer', '다시.png', ['Files'])),
  )
  window.dispatchEvent(new Event('dragend'))
  expect(upload).toHaveBeenCalledTimes(2)

  // 뒤의 첨부를 끌어 앞의 첨부 위로 가져가면 순서가 바뀌고, 그 순서대로 나간다.
  const items = container.querySelectorAll('li[draggable="true"]')
  const drag = (type: string, target: Element, clientX = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { setData: () => {} } })
    Object.defineProperty(event, 'clientX', { value: clientX })
    act(() => void target.dispatchEvent(event))
  }
  drag('dragstart', items[1])
  // 가운데를 넘기 전에는 그대로다(jsdom 의 칸은 전부 0 에 있다).
  drag('dragover', items[0], 1)
  expect(container.querySelector('li')!.querySelector('img')).not.toBeNull()
  drag('dragover', items[0], -1)
  drag('dragend', items[1])
  act(() => container.querySelector('form')!.requestSubmit())
  expect(sendMessage).toHaveBeenLastCalledWith('a', {
    body: '',
    attachments: [
      expect.objectContaining({ name: '보고서.pdf' }),
      expect.objectContaining({ name: '캡처.png' }),
    ],
  })

  act(() => root.unmount())
  upload.mockRestore()
})

test('Tab 을 누르면 쓰던 글 앞에 /ai 가 붙고, 이미 붙어 있으면 초점 이동을 막지 않는다', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        ChatSocketContext,
        { value: socket },
        createElement(Composer, {
          channelId: 'tab',
          channelName: 'tab',
          hash: true,
          mentionCandidates: [],
          onTyping: () => {},
        }),
      ),
    ),
  )
  const box = container.querySelector('textarea')!
  const tab = (init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      ...init,
    })
    act(() => void box.dispatchEvent(event))
    return event.defaultPrevented
  }

  expect(tab()).toBe(true)
  expect(box.value).toBe('/ai ')
  expect(getDraft('tab')).toBe('/ai ')
  // 두 번째 Tab 은 원래대로 다음 칸으로 간다.
  expect(tab()).toBe(false)
  expect(box.value).toBe('/ai ')

  act(() => type(container, '  연차 며칠 남았어'))
  expect(tab({ shiftKey: true })).toBe(false)
  expect(tab()).toBe(true)
  expect(box.value).toBe('/ai 연차 며칠 남았어')
  // 입력칸 위에 `/ai` 칩이 덮인다.
  expect(container.querySelector('[aria-hidden] span')?.textContent).toBe('/ai')

  // `/a` 까지 친 것은 앞에 덧붙이지 않고 이어서 채운다.
  act(() => type(container, '/a'))
  expect(container.querySelector('[aria-hidden] span')).toBeNull()
  expect(tab()).toBe(true)
  expect(box.value).toBe('/ai ')
  act(() => root.unmount())
})

test('문서 주소만 붙여 넣으면 카드가 붙고, 글과 함께 doc_ref 로 나간다', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          ChatSocketContext,
          { value: socket },
          createElement(Composer, {
            channelId: 'a',
            channelName: 'a',
            hash: true,
            mentionCandidates: [],
            onTyping: () => {},
          }),
        ),
      ),
    ),
  )
  const paste = (text: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [], types: ['text/plain'], getData: () => text },
    })
    act(() => void container.querySelector('textarea')!.dispatchEvent(event))
    return event
  }
  const box = () => container.querySelector('textarea')!.value
  const sendButton = () => container.querySelector<HTMLButtonElement>('[aria-label="보내기"]')!

  // 글 속에 섞인 주소는 글로 둔다.
  expect(paste(`이거 보세요 ${location.origin}/docs/d-1`).defaultPrevented).toBe(false)
  // 문서 목록 주소는 문서 하나가 아니다.
  expect(paste(`${location.origin}/docs`).defaultPrevented).toBe(false)

  expect(paste(`  ${location.origin}/docs/d-1  `).defaultPrevented).toBe(true)
  expect(container.textContent).toContain('3분기 계획')
  // 서버는 글 없는 카드를 거절한다. 글을 써야 보낸다.
  expect(sendButton().disabled).toBe(true)
  act(() => type(container, '검토 부탁드립니다'))
  act(() => container.querySelector('form')!.requestSubmit())
  expect(sendMessage).toHaveBeenLastCalledWith('a', {
    body: '검토 부탁드립니다',
    attachments: undefined,
    doc_ref: 'd-1',
  })
  expect(container.textContent).not.toContain('3분기 계획')

  // 떼면 주소가 글로 돌아온다. 문서 주소를 링크 글로 보내는 길이다.
  paste(`${location.origin}/docs/d-1`)
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="문서 카드 떼기"]')!.click())
  expect(container.textContent).not.toContain('3분기 계획')
  expect(box()).toBe(`${location.origin}/docs/d-1`)
  act(() => type(container, ''))

  // 조회 중에는 글이 있어도 못 보낸다. 서버가 카드를 거절하면 비운 글이 사라진다.
  act(() => type(container, '확인'))
  paste(`${location.origin}/docs/d-wait`)
  expect(sendButton().disabled).toBe(true)
  sendMessage.mockClear()
  act(() => container.querySelector('form')!.requestSubmit())
  expect(sendMessage).not.toHaveBeenCalled()

  // 다른 문서를 붙여 넣으면 카드가 바뀌고 앞 주소는 글로 돌아온다.
  paste(`${location.origin}/docs/d-1`)
  expect(box()).toBe(`확인 ${location.origin}/docs/d-wait`)
  expect(sendButton().disabled).toBe(false)
  act(() => type(container, '참고'))
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="문서 카드 떼기"]')!.click())
  act(() => type(container, '참고'))

  // 열 수 없는 문서(못 보는 문서·휴지통)면 카드를 떼고 주소를 글 끝에 되돌린다.
  for (const id of ['d-gone', 'd-trash']) {
    act(() => type(container, '참고'))
    paste(`${location.origin}/docs/${id}`)
    expect(box()).toBe(`참고 ${location.origin}/docs/${id}`)
    expect(container.querySelector('[aria-label="문서 카드 떼기"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('카드 대신 주소로')
  }

  act(() => root.unmount())
})
