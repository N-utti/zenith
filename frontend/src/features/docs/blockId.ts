import { Extension, type Editor } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, type EditorState } from '@tiptap/pm/state'
import { uuid } from '@/lib/uuid'

/** 댓글이 달릴 수 있는 블록. 편집기가 실제로 쓰는 것만. 달 때는 최상위에만 단다. */
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
 * 읽기(parseHTML)는 늘 비워 붙여넣기·HTML 삽입이 id 를 들여오지 못하게 한다. 편집 중 DOM 을
 * 다시 읽을 때는 ProseMirror 가 기존 노드의 속성을 그대로 쓰므로 타이핑으로 지워지지는 않는다.
 * 그래도 복제는 생긴다: `keepOnSplit: false` 는 블록 끝에서 나눌 때만 듣고, 가운데·맨 앞에서
 * Enter 로 나누거나 Ctrl+끌기로 복사하면 속성이 통째로 따라간다. 그래서 내 편집 뒤에 문서를
 * 훑어 같은 id 가 둘 이상이면 하나만 남긴다(내용 있는 첫 블록, 모두 비었으면 첫 블록).
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        // 남에게서 온 변경은 거기서 이미 정리했다. 여기서 또 쓰면 같은 수정이 왕복한다.
        // ponytail: 편집마다 문서 전체를 훑는다. 블록 수천 개 문서에서 느려지면 바뀐 범위만 본다.
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.docChanged && !isChangeOrigin(tr))) return null
          const byId = new Map<string, { pos: number; empty: boolean }[]>()
          state.doc.descendants((node, pos) => {
            const id = node.attrs.blockId as string | null | undefined
            if (!id) return
            const empty = node.content.size === 0 && !node.isAtom
            byId.set(id, [...(byId.get(id) ?? []), { pos, empty }])
          })
          const tr = state.tr
          for (const copies of byId.values()) {
            if (copies.length < 2) continue
            // 맨 앞에서 Enter 로 나누면 앞쪽이 빈 줄이고 글은 뒤로 간다. 빈 쪽이 닻을 가져가면
            // 댓글이 빈 줄을 가리키므로 내용 있는 첫 블록을 남긴다.
            const keep = copies.find((copy) => !copy.empty) ?? copies[0]
            for (const copy of copies) {
              if (copy !== keep) tr.setNodeAttribute(copy.pos, 'blockId', null)
            }
          }
          // 정리는 사용자 편집(분할·복사)과 같은 되돌리기 단위로 둔다. addToHistory false 를 주면
          // y-tiptap 이 마지막 트랜잭션 값으로 합쳐 사용자 편집까지 기록에서 빠진다. 복제는
          // Y.Doc 에 들어간 적이 없으니 되돌리면 분할 전으로 정확히 돌아간다.
          return tr.docChanged ? tr : null
        },
      }),
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

/** 그 id 를 가진 블록의 위치. 목록 안으로 옮겨진 블록도 찾는다. */
export function findBlock(doc: PmNode, blockId: string): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.attrs.blockId === blockId) found = { node, pos }
  })
  return found
}

/** 댓글 목록의 인용에 보이는 블록 앞부분. 글자가 없는 블록(사진·구분선)은 종류로 말한다. 파일 칩은 파일 이름으로 읽는다. */
function blockPreview(node: PmNode): string {
  const text = node
    .textBetween(0, node.content.size, ' ', (leaf) => (leaf.attrs.name as string) ?? '')
    .trim()
  if (text) return text.slice(0, 80)
  if (node.type.name === 'imageBlock') return '사진'
  if (node.type.name === 'horizontalRule') return '구분선'
  return '빈 블록'
}

/**
 * `pos`(없으면 지금 선택)가 든 최상위 블록에 댓글 닻을 준다. 이미 있으면 그대로 쓴다.
 *
 * 되돌리기(Ctrl+Z)에 들지 않게 한다. 되돌리기로 id 가 빠지면 이미 단 댓글이 "지워진 블록"이 된다.
 *
 * 두 사람이 같은 블록에 거의 동시에 첫 닻을 주면 각자 준 id 중 하나만 Y.Doc 에 남는다. 진 쪽은
 * 제 닻이 사라져 댓글 창이 닫힌다(BlockComments). 다시 열면 이긴 닻을 받는다.
 */
export function anchorBlock(editor: Editor, pos?: number): string | null {
  const block = topBlockAt(editor.state.doc, pos ?? editor.state.selection.from)
  if (!block || !BLOCK_TYPES.includes(block.node.type.name)) return null

  let blockId = block.node.attrs.blockId as string | null
  if (!blockId) {
    blockId = uuid()
    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(block.pos, 'blockId', blockId)
        .setMeta('addToHistory', false),
    )
  }
  return blockId
}

/**
 * 문서에 살아 있는 닻 블록들. 댓글 목록이 인용과 "지워진 블록"을 가르는 데 쓴다.
 * 닻 문단을 목록·인용으로 감싸도 찾는다. 반대로 목록 자체에 단 닻은 목록을 풀면 사라진다
 * (목록 노드가 없어지므로). 그 댓글은 "지워진 블록"이 된다.
 */
export function anchoredBlocks(doc: PmNode): Record<string, string> {
  const found: Record<string, string> = {}
  doc.descendants((node) => {
    const id = node.attrs.blockId as string | null | undefined
    if (id) found[id] = blockPreview(node)
  })
  return found
}

/**
 * 커서가 표의 첫 행에 있으면 그 표의 닻. 그 자리에는 행 옆 표 버튼(TableRowMenu)이 떠서
 * 표의 댓글 말풍선(BlockComments)과 겹친다.
 */
export function firstRowTableAnchor(state: EditorState): string | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'table') continue
    return $from.index(depth) === 0 ? ((node.attrs.blockId as string | null) ?? null) : null
  }
  return null
}

/** 잠깐 밝힌다(`--animate-flash` 와 같은 2초). 색은 시맨틱 토큰에서 읽어 라이트·다크를 따른다. */
export function flashElement(el: HTMLElement) {
  const soft = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-soft')
  // 끝 프레임을 비워 두면 원래 배경(인용·코드 블록의 바탕)으로 돌아간다.
  el.animate([{ backgroundColor: soft }, {}], { duration: 2000, easing: 'ease-out' })
}

/**
 * 그 블록으로 굴려 가서 잠깐 밝힌다. 못 찾으면 `false`(호출부는 무시해도 된다).
 *
 * DOM 을 `data-block-id` 로 찾지 않고 문서에서 위치를 찾아 `nodeDOM` 으로 잡는다. 표·사진은
 * 노드 뷰라 속성이 DOM 에 안 붙거나 늦게 붙는다. 클래스를 붙이지 않고 Web Animations 로 칠하는
 * 것은 편집기 DOM 의 속성을 바꾸면 ProseMirror 가 그 블록을 다시 읽기 때문이다.
 */
export function flashBlock(editor: Editor, blockId: string): boolean {
  const block = findBlock(editor.state.doc, blockId)
  const el = block && editor.view.nodeDOM(block.pos)
  if (!(el instanceof HTMLElement)) return false
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashElement(el)
  return true
}
