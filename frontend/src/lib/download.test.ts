import { afterEach, expect, it, vi } from 'vitest'
import { downloadText } from './download'

afterEach(() => vi.unstubAllGlobals())

it('BOM 을 앞에 붙여 저장한다(엑셀 한글)', async () => {
  let blob: Blob | undefined
  // jsdom 에는 createObjectURL 이 없다.
  vi.stubGlobal('URL', {
    createObjectURL: (b: Blob) => ((blob = b), 'blob:x'),
    revokeObjectURL: () => {},
  })
  downloadText('a.csv', 'x')
  // text() 는 규격상 앞의 BOM 을 떼고 디코딩한다. 바이트로 본다.
  expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x78])
})
