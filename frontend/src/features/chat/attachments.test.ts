import { expect, it } from 'vitest'
import { isImage } from './attachments'
import { formatBytes } from '@/lib/format'

it('서버가 inline 으로 주는 형식만 미리 보여 준다', () => {
  for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp']) {
    expect(isImage(name)).toBe(true)
  }
  // SVG 는 같은 오리진에서 스크립트가 돌 수 있어 서버도 내려받기로만 준다.
  for (const name of ['x.svg', 'y.html', 'z.pdf', 'no-extension', 'png', 'a.png.exe']) {
    expect(isImage(name)).toBe(false)
  }
})

it('파일 크기를 사람이 읽는 단위로', () => {
  expect(formatBytes(0)).toBe('0B')
  expect(formatBytes(1023)).toBe('1023B')
  expect(formatBytes(1024)).toBe('1KB')
  expect(formatBytes(1024 * 1024)).toBe('1.0MB')
  expect(formatBytes(10 * 1024 * 1024)).toBe('10.0MB')
})
