import { expect, it } from 'vitest'
import { isImage, reorder } from './attachments'
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

it('첨부를 옮기면 나머지가 한 칸씩 밀리고, 범위 밖이면 그대로다', () => {
  const list = ['a', 'b', 'c']
  expect(reorder(list, 2, 0)).toEqual(['c', 'a', 'b'])
  expect(reorder(list, 0, 2)).toEqual(['b', 'c', 'a'])
  expect(reorder(list, 0, 3)).toBe(list)
  expect(reorder(list, -1, 1)).toBe(list)
  expect(reorder(list, 1, 1)).toBe(list)
})
