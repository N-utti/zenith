import { afterEach, expect, it, vi } from 'vitest'
import { downloadBytes } from './download'

afterEach(() => vi.unstubAllGlobals())

it('넘긴 바이트가 그대로 Blob 에 들어간다', async () => {
  let blob: Blob | undefined
  // jsdom 에는 createObjectURL 이 없다.
  vi.stubGlobal('URL', {
    createObjectURL: (b: Blob) => ((blob = b), 'blob:x'),
    revokeObjectURL: () => {},
  })
  downloadBytes('a.xlsx', new Uint8Array([0x50, 0x4b]), 'application/zip')
  expect(blob!.type).toBe('application/zip')
  expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0x50, 0x4b])
})
