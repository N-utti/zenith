import type { Editor } from '@tiptap/react'
import {
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SquareCode,
  Table,
  Type,
} from 'lucide-react'
import { Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PICK_IMAGE_EVENT } from './ImageBlock'

/** 인라인 AI 팝오버를 여는 신호. 사진 고르기와 같은 방식으로 편집기 DOM에 쏜다. */
export const OPEN_INLINE_AI_EVENT = 'zenith:open-inline-ai'

/** 블록 종류 하나. 툴바 드롭다운·슬래시 메뉴·버블 메뉴가 이 목록 하나를 공유한다. */
export type EditorBlock = {
  key: string
  label: string
  /** 슬래시 메뉴에서 라벨 아래 붙는 한 줄 설명 */
  hint: string
  /** 슬래시 메뉴 검색어. 한글 조합 중에도 잡히도록 영문 별칭을 함께 둔다. */
  keywords: string[]
  icon: LucideIcon
  /** 현재 커서가 이 블록 안인지. 삽입 전용 항목(구분선)은 없다. */
  isActive?: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

/** 목록·인용 안에서 제목으로 바꿀 때 바깥으로 꺼낸 뒤 적용한다(노션과 같은 동작). */
function toHeading(editor: Editor, level: 1 | 2 | 3) {
  editor.chain().focus().clearNodes().setHeading({ level }).run()
}

export const EDITOR_BLOCKS: EditorBlock[] = [
  {
    key: 'ai',
    label: 'AI로 쓰기',
    hint: '요약·이어쓰기·다듬기를 이 자리에서',
    keywords: ['ai', '에이아이', '요약', '이어쓰기', '다듬기', '번역', 'gpt', 'llm'],
    icon: Sparkles,
    run: (e) => {
      if (!e.isEditable) return
      e.commands.focus()
      e.view.dom.dispatchEvent(new CustomEvent(OPEN_INLINE_AI_EVENT))
    },
  },
  {
    key: 'paragraph',
    label: '본문',
    hint: '일반 텍스트로 씁니다',
    keywords: ['본문', '텍스트', 'text', 'paragraph', 'p'],
    isActive: (e) => e.isActive('paragraph'),
    icon: Type,
    run: (e) => e.chain().focus().clearNodes().setParagraph().run(),
  },
  {
    key: 'h1',
    label: '제목 1',
    hint: '가장 큰 구역 제목',
    keywords: ['제목', 'heading', 'h1', 'title'],
    isActive: (e) => e.isActive('heading', { level: 1 }),
    icon: Heading1,
    run: (e) => toHeading(e, 1),
  },
  {
    key: 'h2',
    label: '제목 2',
    hint: '중간 크기 제목',
    keywords: ['제목', 'heading', 'h2'],
    isActive: (e) => e.isActive('heading', { level: 2 }),
    icon: Heading2,
    run: (e) => toHeading(e, 2),
  },
  {
    key: 'h3',
    label: '제목 3',
    hint: '작은 소제목',
    keywords: ['제목', 'heading', 'h3'],
    isActive: (e) => e.isActive('heading', { level: 3 }),
    icon: Heading3,
    run: (e) => toHeading(e, 3),
  },
  {
    key: 'bulletList',
    label: '글머리 목록',
    hint: '순서 없는 목록',
    keywords: ['목록', '리스트', 'bullet', 'list', 'ul'],
    isActive: (e) => e.isActive('bulletList'),
    icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    label: '번호 목록',
    hint: '1. 2. 3. 순서가 붙는 목록',
    keywords: ['번호', '목록', 'number', 'ordered', 'ol'],
    isActive: (e) => e.isActive('orderedList'),
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'taskList',
    label: '할 일 목록',
    hint: '체크박스로 진행 상황을 표시',
    keywords: ['할일', '체크', '투두', 'todo', 'task', 'check'],
    isActive: (e) => e.isActive('taskList'),
    icon: ListTodo,
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    key: 'blockquote',
    label: '인용',
    hint: '왼쪽에 세로선이 붙는 인용문',
    keywords: ['인용', 'quote', 'blockquote'],
    isActive: (e) => e.isActive('blockquote'),
    icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'codeBlock',
    label: '코드 블록',
    hint: '여러 줄 코드를 그대로 보존',
    keywords: ['코드', 'code', 'pre', 'snippet'],
    isActive: (e) => e.isActive('codeBlock'),
    icon: SquareCode,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: 'image',
    label: '사진',
    hint: '파일을 골라 문서에 넣습니다',
    keywords: ['사진', '이미지', '그림', 'image', 'photo', 'picture', 'img'],
    icon: ImagePlus,
    run: (e) => {
      if (!e.isEditable) return
      e.commands.focus()
      e.view.dom.dispatchEvent(new CustomEvent(PICK_IMAGE_EVENT))
    },
  },
  {
    key: 'table',
    label: '표',
    hint: '머리 행이 있는 3x3 표를 넣습니다',
    keywords: ['표', '테이블', 'table'],
    icon: Table,
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    key: 'horizontalRule',
    label: '구분선',
    hint: '내용을 가로선으로 나눕니다',
    keywords: ['구분선', '가로줄', 'divider', 'hr', 'line'],
    icon: Minus,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
]

export const BLOCK_BY_KEY: Record<string, EditorBlock> = Object.fromEntries(
  EDITOR_BLOCKS.map((block) => [block.key, block]),
)

/** 툴바 드롭다운이 지금 무엇을 보여 줄지 고른다. 좁은 것부터 검사해야 인용 속 제목이 '인용'으로 뭉개지지 않는다. */
export function activeBlock(editor: Editor): EditorBlock {
  const matched = EDITOR_BLOCKS.find(
    (block) => block.key !== 'paragraph' && block.isActive?.(editor),
  )
  // 아무것도 안 걸리면 본문이다. 목록 순서에 기대지 않고 키로 찾는다.
  return matched ?? BLOCK_BY_KEY.paragraph
}

/** 슬래시 메뉴 검색. 질의가 비면 전체를 그대로 돌려준다. */
export function filterBlocks(query: string): EditorBlock[] {
  const q = query.trim().toLowerCase()
  if (!q) return EDITOR_BLOCKS
  return EDITOR_BLOCKS.filter(
    (block) =>
      block.label.toLowerCase().includes(q) ||
      block.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  )
}
