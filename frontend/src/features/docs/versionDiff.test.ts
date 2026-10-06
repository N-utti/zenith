import { describe, expect, it } from 'vitest'
import { diffBlocks } from './versionDiff'

const p = (text: string, attrs?: Record<string, unknown>) => ({
  type: 'paragraph',
  ...(attrs && { attrs }),
  content: [{ type: 'text', text }],
})
const doc = (...content: object[]) => ({ type: 'doc', content })

describe('diffBlocks', () => {
  it('고쳐 쓴 블록은 지운 것과 더한 것으로 나오고 서로 짝이 된다', () => {
    const diff = diffBlocks(
      doc(p('가'), p('나'), p('다')),
      doc(p('가'), p('나나'), p('다'), p('라')),
    )

    expect(diff.marks).toEqual([
      { change: 'same' },
      { change: 'removed', pair: 2 },
      { change: 'added', pair: 1 },
      { change: 'same' },
      { change: 'added' },
    ])
    expect(diff.json.content?.map((block) => block.content?.[0].text)).toEqual([
      '가',
      '나',
      '나나',
      '다',
      '라',
    ])
    expect([diff.added, diff.removed]).toEqual([2, 1])
  })

  it('댓글 닻만 붙은 블록은 바뀐 것으로 치지 않는다', () => {
    const diff = diffBlocks(doc(p('가')), doc(p('가', { blockId: 'x' })))
    expect(diff.marks).toEqual([{ change: 'same' }])
  })

  it('종류가 다른 블록은 짝짓지 않는다', () => {
    const diff = diffBlocks(doc(p('가')), doc({ type: 'horizontalRule' }))
    expect(diff.marks).toEqual([{ change: 'removed' }, { change: 'added' }])
  })
})
