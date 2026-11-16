import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toastApi } from '@/components/ui/ToastContext'
import { downloadBytes } from './download'

beforeEach(() =>
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete window.__TAURI__
})

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

it('데스크톱 앱에서만 어디에 저장했는지 알린다', () => {
  const success = vi.spyOn(toastApi, 'success').mockImplementation(() => {})
  downloadBytes('a.xlsx', new Uint8Array(), 'application/zip')
  expect(success).not.toHaveBeenCalled()

  window.__TAURI__ = { core: { invoke: vi.fn() } }
  downloadBytes('a.xlsx', new Uint8Array(), 'application/zip')
  expect(success).toHaveBeenCalledWith('다운로드 폴더에 저장했습니다: a.xlsx')
})
