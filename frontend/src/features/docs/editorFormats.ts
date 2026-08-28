import { useEditorState, type Editor } from '@tiptap/react'
import { TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart } from 'lucide-react'
import { activeBlock } from './editorBlocks'

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
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: (e.getAttributes('highlight').color as string | undefined) ?? null,
      link: (e.getAttributes('link').href as string | undefined) ?? null,
      align: ALIGNMENTS.find(({ value }) => e.isActive({ textAlign: value }))?.value ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
}

export type FormatState = ReturnType<typeof useFormatState>
