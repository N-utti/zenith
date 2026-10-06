import { afterEach, expect, test, vi } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
  // jsdom 에는 `execCommand` 가 없어 테스트가 붙인 것이다.
  delete (document as { execCommand?: unknown }).execCommand
})

// 평문 http 로 열면 `navigator.clipboard` 가 없다. 사무실 PC 가 들어오는 주소가 그 주소다.
test('navigator.clipboard 가 없으면 옛 방식으로 복사하고 흔적을 남기지 않는다', async () => {
  vi.stubGlobal('navigator', {})
  let selected = ''
  document.execCommand = vi.fn(() => {
    selected = (document.activeElement as HTMLTextAreaElement).value
    return true
  })
  const button = document.body.appendChild(document.createElement('button'))
  button.focus()

  await copyText('zenith@example.com')

  expect(document.execCommand).toHaveBeenCalledWith('copy')
  expect(selected).toBe('zenith@example.com')
  expect(document.querySelector('textarea')).toBeNull()
  expect(document.activeElement).toBe(button)
  button.remove()
})

test('옛 방식도 안 되면 던진다. 부르는 쪽이 실패를 알린다', async () => {
  vi.stubGlobal('navigator', {})
  document.execCommand = vi.fn(() => false)
  await expect(copyText('x')).rejects.toThrow()
})
