import { useEditorState, type Editor } from '@tiptap/react'
import { CellSelection } from '@tiptap/pm/tables'
import { TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart } from 'lucide-react'
import { activeBlock } from './editorBlocks'
import { blockFormat, fontName, fontPoints } from './exportContent'

export const ALIGNMENTS = [
  { value: 'left', label: '왼쪽 정렬', icon: TextAlignStart },
  { value: 'center', label: '가운데 정렬', icon: TextAlignCenter },
  { value: 'right', label: '오른쪽 정렬', icon: TextAlignEnd },
  { value: 'justify', label: '양쪽 정렬', icon: TextAlignJustify },
]

/* 글자색은 밝은 배경·어두운 배경 양쪽에서 읽히는 중간 톤으로 고른다.
   형광펜은 항상 옅은 색이라, 글자를 짙게 고정하는 규칙이 index.css에 있다. */

export const TEXT_COLORS = [
  { label: '회색', value: '#6b7280' },
  { label: '갈색', value: '#8b6b4f' },
  { label: '빨강', value: '#e0483d' },
  { label: '주황', value: '#ea7317' },
  { label: '노랑', value: '#d4a017' },
  { label: '초록', value: '#2ea36a' },
  { label: '파랑', value: '#3b82f6' },
  { label: '보라', value: '#8b5cf6' },
  { label: '분홍', value: '#e0559b' },
]

export const HIGHLIGHT_COLORS = [
  { label: '노랑', value: '#fef08a' },
  { label: '초록', value: '#bbf7d0' },
  { label: '파랑', value: '#bfdbfe' },
  { label: '보라', value: '#e9d5ff' },
  { label: '분홍', value: '#fbcfe8' },
  { label: '주황', value: '#fed7aa' },
  { label: '빨강', value: '#fecaca' },
  { label: '회색', value: '#e2e5ea' },
]

/**
 * 글꼴. 글꼴 파일은 싣지 않으므로(CDN 금지) 사내 Windows PC 에 기본으로 깔린 것만 둔다.
 * 그 글꼴이 없는 기기(아이폰 등)에서는 본문 글꼴로 보인다. 값은 문서에 그대로 남는다.
 */
export const FONT_FAMILIES = [
  '맑은 고딕',
  '바탕',
  '돋움',
  '굴림',
  '궁서',
  'Arial',
  'Times New Roman',
]
/** 글자 크기(pt). 워드·한글의 목록에서 자주 쓰는 것만. */
export const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]
/** 줄 간격(배수). 문서에는 단위 없는 문자열로 남는다(이슈 #574 계약). */
export const LINE_HEIGHTS = [
  { value: '1', label: '1.0' },
  { value: '1.15', label: '1.15' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: '2.0' },
]
/** 들여쓰기 한 번의 폭(px). 목록 한 단계(index.css 의 pl-6)와 같다. */
export const INDENT_STEP = 24
const MAX_INDENT = INDENT_STEP * 20

/** 문단 서식을 줄 블록. */
const FORMAT_BLOCKS = ['paragraph', 'heading']
/** 들여쓰기가 들어가지 않는 곳. 목록 안의 들여쓰기는 목록이 맡는다(Tab). */
const LISTS = ['bulletList', 'orderedList', 'taskList']

/** 고른 범위의 문단·제목에 문단 서식 하나를 쓴다. `null` 이면 지운다(본문 기본으로). */
export function setBlockFormat(
  editor: Editor,
  name: 'lineHeight' | 'spaceBefore' | 'spaceAfter',
  value: string | number | null,
) {
  const chain = editor.chain().focus()
  for (const type of FORMAT_BLOCKS) chain.updateAttributes(type, { [name]: value })
  chain.run()
}

/**
 * 고른 범위의 문단·제목을 한 단계씩 들이거나 내어 쓴다. 문단마다 지금 값에서 센다. 목록 안은 건너뛴다.
 * 여러 칸을 고른 표는 칸마다 범위가 따로라(selection.from·to 는 첫 칸뿐) 범위를 다 돈다.
 * 상한보다 깊이 들여 쓴 문단(가져온 문서)은 늘리기로 줄어들지 않게 그대로 둔다.
 */
export function changeIndent(editor: Editor, steps: number) {
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      for (const { $from, $to } of state.selection.ranges) {
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (LISTS.includes(node.type.name)) return false
          if (!FORMAT_BLOCKS.includes(node.type.name)) return true
          const now = blockFormat(node.attrs).indent ?? 0
          const moved = now + steps * INDENT_STEP
          const next = steps > 0 ? Math.max(now, Math.min(MAX_INDENT, moved)) : Math.max(0, moved)
          if (next !== now) tr.setNodeAttribute(pos, 'indent', next || null)
          return false
        })
      }
      return true
    })
    .run()
}

/**
 * 칸 배경색. 여러 칸을 골랐으면 그 칸 모두에, 아니면 커서가 든 칸에 칠한다. 표 확장의 setCellAttribute 는
 * 기준 칸이 이미 그 색이면 나머지 칸을 건너뛰어서, 여러 칸은 칸마다 직접 쓴다.
 */
export function setCellBackground(editor: Editor, color: string | null) {
  const { selection } = editor.state
  if (!(selection instanceof CellSelection)) {
    editor.chain().focus().setCellAttribute('backgroundColor', color).run()
    return
  }
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      selection.forEachCell((cell, pos) => {
        if (cell.attrs.backgroundColor !== color) tr.setNodeAttribute(pos, 'backgroundColor', color)
      })
      return true
    })
    .run()
}

/**
 * 에디터 상태는 React 밖에서 바뀐다. 이 훅이 없으면 버튼 활성 표시가 멈춘다.
 * 툴바와 버블 메뉴가 같은 값을 봐야 하므로 한 곳에서 만든다.
 */
export function useFormatState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      blockKey: activeBlock(e).key,
      inTable: e.isActive('table'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: (e.getAttributes('highlight').color as string | undefined) ?? null,
      link: (e.getAttributes('link').href as string | undefined) ?? null,
      align: ALIGNMENTS.find(({ value }) => e.isActive({ textAlign: value }))?.value ?? 'left',
      // 글꼴은 이름(따옴표 뗀 것), 크기는 pt 로 맞춰 둔다. 가져온 문서는 `'맑은 고딕'`·`11pt` 꼴로 온다.
      font: fontName(e.getAttributes('textStyle').fontFamily),
      fontSize: fontPoints(e.getAttributes('textStyle').fontSize),
      lineHeight: blockFormat(e.getAttributes(e.isActive('heading') ? 'heading' : 'paragraph'))
        .line,
      inList: LISTS.some((list) => e.isActive(list)),
      // 들여 쓸 문단·제목에 커서가 있을 때만. 코드 블록·사진에서는 누를 것이 없다.
      canIndent: e.isActive('paragraph') || e.isActive('heading'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
}

export type FormatState = ReturnType<typeof useFormatState>
