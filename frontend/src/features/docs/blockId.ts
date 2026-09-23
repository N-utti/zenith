import { Extension, type Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'

/** 댓글이 달릴 수 있는 최상위 블록. 편집기가 실제로 쓰는 것만. */
const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'horizontalRule',
  'table',
  'imageBlock',
]

/**
 * 블록 댓글의 닻(05 SCR-02, FR-DOC-04). 댓글의 `block_id` 가 가리키는 값이다.
 *
 * 모든 블록에 미리 붙이지 않고 댓글을 달 때 그 블록에만 준다. 전 블록에 붙이는 전역 규칙은
 * 공동편집 중인 탭마다 따로 돌아 같은 블록에 서로 다른 id 를 쓰며 경합한다.
 * 붙인 값은 노드 속성이라 Y.Doc 이 다른 속성(제목 수준·정렬)과 똑같이 실어 나른다.
 *
 * 읽기(parseHTML)는 늘 비운다. 붙여넣기·HTML 삽입으로 같은 id 가 두 블록에 생기면 댓글이
 * 어느 쪽을 가리키는지 알 수 없다. 편집 중 DOM 을 다시 읽을 때는 ProseMirror 가 기존 노드의
 * 속성을 그대로 쓰므로 타이핑으로 id 가 지워지지는 않는다. 블록을 나눌 때도 뒤쪽은 비운다.
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ]
  },
})

/** 커서가 든 최상위 블록과 그 시작 위치. 문서 맨 앞 틈 같은 데서는 없다. */
function topBlockAt(doc: PmNode, pos: number): { node: PmNode; pos: number } | null {
  const $pos = doc.resolve(pos)
  if ($pos.depth === 0) {
    const node = doc.nodeAt(pos)
    return node ? { node, pos } : null
  }
  return { node: $pos.node(1), pos: $pos.before(1) }
}

/** 칩·인용에 보이는 블록 앞부분. 글자가 없는 블록(사진·구분선)은 종류로 말한다. */
export function blockPreview(node: PmNode): string {
  const text = node.textContent.trim()
  if (text) return text.slice(0, 80)
  if (node.type.name === 'imageBlock') return '사진'
  if (node.type.name === 'horizontalRule') return '구분선'
  return '빈 블록'
}

/**
 * `pos`(없으면 지금 선택)가 든 최상위 블록에 댓글 닻을 준다. 이미 있으면 그대로 쓴다.
 *
 * 되돌리기(Ctrl+Z)에 들지 않게 한다. 되돌리기로 id 가 빠지면 이미 단 댓글이 "지워진 블록"이 된다.
 */
export function anchorBlock(
  editor: Editor,
  pos = editor.state.selection.from,
): { blockId: string; preview: string } | null {
  const block = topBlockAt(editor.state.doc, pos)
  if (!block || !BLOCK_TYPES.includes(block.node.type.name)) return null

  let blockId = block.node.attrs.blockId as string | null
  if (!blockId) {
    blockId = crypto.randomUUID()
    const tr = editor.state.tr
      .setNodeMarkup(block.pos, undefined, { ...block.node.attrs, blockId })
      .setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
  return { blockId, preview: blockPreview(block.node) }
}

/** 문서에 살아 있는 닻 블록들. 댓글 목록이 인용과 "지워진 블록"을 가르는 데 쓴다. */
export function anchoredBlocks(doc: PmNode): Record<string, string> {
  const found: Record<string, string> = {}
  doc.forEach((node) => {
    const id = node.attrs.blockId as string | null | undefined
    if (id) found[id] = blockPreview(node)
  })
  return found
}

/**
 * 그 블록으로 굴려 가서 잠깐 밝힌다(`--animate-flash` 와 같은 2초).
 *
 * 클래스를 붙이지 않고 Web Animations 로 칠한다. 편집기 DOM 의 속성을 바꾸면 ProseMirror 가
 * 그 블록을 다시 읽는다. 색은 시맨틱 토큰에서 읽어 라이트·다크를 따른다.
 */
export function flashBlock(editor: Editor, blockId: string): boolean {
  const el = editor.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const soft = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-soft')
  el.animate([{ backgroundColor: soft }, { backgroundColor: 'transparent' }], {
    duration: 2000,
    easing: 'ease-out',
  })
  return true
}
