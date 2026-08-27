import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // 에디터가 포커스를 잃으면 선택 영역이 사라져 서식이 엉뚱한 곳에 걸린다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-8 cursor-pointer place-items-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}

function Divider() {
  return <span className="bg-line mx-1 h-5 w-px" />
}

export function EditorToolbar({ editor }: { editor: Editor }) {
  // 에디터 상태는 React 밖에서 바뀐다. 이 훅이 없으면 버튼 활성 표시가 멈춘다.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  return (
    <div className="border-line bg-surface/90 sticky top-14 z-10 flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 backdrop-blur">
      <ToolButton
        icon={Bold}
        label="굵게"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        icon={Italic}
        label="기울임"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        icon={Strikethrough}
        label="취소선"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolButton
        icon={Code}
        label="인라인 코드"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />

      <Divider />

      <ToolButton
        icon={Heading2}
        label="제목 2"
        active={state.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon={Heading3}
        label="제목 3"
        active={state.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <Divider />

      <ToolButton
        icon={List}
        label="글머리 목록"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        icon={ListOrdered}
        label="번호 목록"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        icon={Quote}
        label="인용"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />

      <Divider />

      {/* 되돌리기는 Yjs UndoManager가 담당한다 — 남의 편집은 건드리지 않고 내 것만 되돌린다. */}
      <ToolButton
        icon={Undo2}
        label="실행 취소"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolButton
        icon={Redo2}
        label="다시 실행"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      />
    </div>
  )
}
