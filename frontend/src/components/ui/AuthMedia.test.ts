import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthImg, DownloadLink } from './AuthMedia'
import { ToastContext, type ToastApi } from './ToastContext'

const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api }))
const downloadFromApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/download', () => ({ downloadFromApi }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  vi.clearAllMocks()
})

function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  root = createRoot(container)
  act(() => root!.render(element))
  return container
}

// #446: access 가 죽어 그림이 401 이면 한 번 갱신하고 주소를 바꿔 다시 받는다. 두 번째 실패만 넘긴다.
test('그림을 못 받으면 /me 로 갱신하고 한 번만 다시 받는다', async () => {
  api.mockRejectedValue(new Error('401'))
  const onError = vi.fn()
  const container = mount(createElement(AuthImg, { path: '/api/files/f1', onError }))
  const img = () => container.querySelector('img')!
  expect(img().getAttribute('src')).toBe('/api/files/f1')

  await act(async () => img().dispatchEvent(new Event('error')))
  expect(api).toHaveBeenCalledWith('/me')
  expect(img().getAttribute('src')).toBe('/api/files/f1?r=1')
  expect(onError).not.toHaveBeenCalled()

  await act(async () => img().dispatchEvent(new Event('error')))
  expect(onError).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledTimes(1)

  // 문서 사진 블록은 같은 컴포넌트에 주소만 바뀐다. 새 그림은 다시 한 번 기회를 받는다.
  act(() => root!.render(createElement(AuthImg, { path: '/api/files/f2', onError })))
  expect(img().getAttribute('src')).toBe('/api/files/f2')
})

test('내려받기 링크는 이동을 막고 앱이 받으며, 실패하면 알린다', async () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() } satisfies ToastApi
  downloadFromApi.mockRejectedValue(new Error('net'))
  const container = mount(
    createElement(
      ToastContext,
      { value: toast },
      createElement(DownloadLink, { path: '/api/x', name: 'a.txt' }, '받기'),
    ),
  )
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  await act(async () => container.querySelector('a')!.dispatchEvent(click))
  expect(click.defaultPrevented).toBe(true)
  expect(downloadFromApi).toHaveBeenCalledWith('/api/x', 'a.txt')
  expect(toast.error).toHaveBeenCalledWith('파일을 내려받지 못했습니다.')
})
