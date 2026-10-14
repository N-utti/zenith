import { getTextSerializersFromSchema } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'

/**
 * 본문에서 그 글이 `after` 위치부터 처음 나오는 자리(ProseMirror 위치). 못 찾으면 `null`.
 *
 * 평문 비교(`indexOf`)만 한다. 찾는 글은 AI 가 낸 것이라 정규식으로 읽으면 안 된다(백엔드 #382).
 * 블록 하나 안에서만 찾는다. 두 블록에 걸친 글은 못 찾는다(그때는 이동하지 않는다).
 * 줄 안의 글자 아닌 노드(줄바꿈·파일 칩)는 `editor.getText()` 와 같은 글로 바꿔 비교한다. 서버는 그 글에서
 * 발췌를 확인하므로, 같게 만들어야 서버가 통과시킨 발췌를 여기서도 찾는다. 그 글자들의 자리는 노드 시작이다.
 */
export function findText(
  doc: PmNode,
  text: string,
  after = 0,
): { from: number; to: number } | null {
  if (!text) return null
  const serializers = getTextSerializersFromSchema(doc.type.schema)
  let found: { from: number; to: number } | null = null
  doc.descendants((block, blockPos) => {
    if (found) return false
    if (!block.isTextblock) return true
    let flat = ''
    const posAt: number[] = []
    block.forEach((child, offset, index) => {
      const start = blockPos + 1 + offset
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) posAt.push(start + i)
        flat += child.text
        return
      }
      const chars =
        serializers[child.type.name]?.({
          node: child,
          pos: start,
          parent: block,
          index,
          range: { from: 0, to: doc.content.size },
        }) ?? ''
      for (let i = 0; i < chars.length; i++) posAt.push(start)
      flat += chars
    })
    for (let at = flat.indexOf(text); at >= 0; at = flat.indexOf(text, at + 1)) {
      if (posAt[at] < after) continue
      found = { from: posAt[at], to: posAt[at + text.length - 1] + 1 }
      break
    }
    return false
  })
  return found
}
