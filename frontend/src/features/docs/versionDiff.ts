import { Extension } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * 합친 문서의 최상위 블록 하나가 어느 쪽에서 왔는지.
 * `pair` 는 고쳐 쓴 블록의 짝(합친 문서에서의 순번). 글자 단위 표시에 쓴다.
 */
export interface BlockMark {
  change: 'same' | 'added' | 'removed'
  pair?: number
}

export interface VersionDiffResult {
  /** 두 버전을 합친 문서. 지워진 블록이 제자리에 끼어 있다. 보여 주기 전용이고 되돌리기에는 쓰지 않는다. */
  json: JSONContent
  marks: BlockMark[]
  added: number
  removed: number
}

// 댓글 닻(blockId)만 붙은 블록은 바뀐 것이 아니다. 닻을 빼고 남는 속성이 없으면 attrs 째로 뺀다.
// 속성 없는 블록은 스냅샷에서 attrs 없이 나오기 때문이다.
const keyOf = (block: JSONContent) =>
  JSON.stringify(block, (key, value: unknown) => {
    if (key !== 'attrs' || !value) return value
    const rest = Object.entries(value).filter(([name]) => name !== 'blockId')
    return rest.length ? Object.fromEntries(rest) : undefined
  })

/**
 * 앞 버전과 이 버전을 최상위 블록 단위로 견준다(git diff 의 줄이 여기서는 블록이다).
 * 고쳐 쓴 블록은 지운 것 하나와 더한 것 하나로 나온다.
 */
export function diffBlocks(before: JSONContent, after: JSONContent): VersionDiffResult {
  const a = before.content ?? []
  const b = after.content ?? []
  const ka = a.map(keyOf)
  const kb = b.map(keyOf)

  // lcs[i][j]: a 의 i 번째부터와 b 의 j 번째부터가 순서대로 같이 가진 블록 수.
  // ponytail: 블록 수의 곱만큼 칸을 쓴다. 블록 수천 개 문서에서 느리면 앞뒤 공통 구간을 먼저 걷어 낸다.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const content: JSONContent[] = []
  const marks: BlockMark[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      content.push(b[j])
      marks.push({ change: 'same' })
      i++
      j++
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      // 비기면 지운 쪽을 먼저 낸다. 한 덩어리 안에서 지운 것이 위, 더한 것이 아래에 온다.
      content.push(a[i++])
      marks.push({ change: 'removed' })
    } else {
      content.push(b[j++])
      marks.push({ change: 'added' })
    }
  }

  // 한 덩어리 안에서 지운 것과 더한 것을 차례로 짝지어 고쳐 쓴 블록으로 본다.
  // ponytail: 순서로만 짝짓는다. 고친 블록 앞에 새 블록을 끼우면 새 블록과 짝이 되어 글자 단위 표시가
  // 어긋난다(블록 단위 표시는 맞다). 거슬리면 앞부분이 가장 길게 같은 후보를 고른다.
  let unpaired: number[] = []
  marks.forEach((mark, index) => {
    if (mark.change === 'same') unpaired = []
    else if (mark.change === 'removed') unpaired.push(index)
    else {
      const removed = unpaired.shift()
      if (removed !== undefined && content[removed].type === content[index].type) {
        mark.pair = removed
        marks[removed].pair = index
      }
    }
  })

  return {
    json: { ...after, content },
    marks,
    added: marks.filter((mark) => mark.change === 'added').length,
    removed: marks.filter((mark) => mark.change === 'removed').length,
  }
}

/**
 * `diffBlocks` 의 결과를 미리보기에 칠한다. 문서는 건드리지 않고 장식만 얹는다.
 * 짝이 있는 블록은 그 안에서 실제로 달라진 구간을 한 번 더 진하게 칠한다.
 */
export const VersionDiff = Extension.create<{ marks: BlockMark[] }>({
  name: 'versionDiff',

  addOptions() {
    return { marks: [] }
  },

  addProseMirrorPlugins() {
    const { marks } = this.options
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const decorations: Decoration[] = []
            doc.forEach((node, pos, index) => {
              const mark = marks[index]
              if (!mark || mark.change === 'same') return
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { class: `diff-${mark.change}` }),
              )

              if (mark.pair === undefined || mark.pair >= doc.childCount) return
              const other = doc.child(mark.pair).content
              const from = node.content.findDiffStart(other)
              const ends = node.content.findDiffEnd(other)
              if (from == null || !ends) return
              // 같은 글자가 되풀이되면 뒤에서 잰 끝이 앞에서 잰 시작보다 앞선다. 겹친 만큼 뒤로 민다.
              const to = ends.a + Math.max(0, from - Math.min(ends.a, ends.b))
              if (to > from) {
                decorations.push(
                  Decoration.inline(pos + 1 + from, pos + 1 + to, { class: 'diff-part' }),
                )
              }
            })
            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
