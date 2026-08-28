import type { Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  LoaderCircle,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'
import { BLOCK_BY_KEY } from './editorBlocks'
import { AlignMenu, BlockMenu, ColorMenu, LinkMenu, ToolButton, ToolDivider } from './editorControls'
import { useFormatState } from './editorFormats'

export function EditorToolbar({
  editor,
  uploadingImage,
}: {
  editor: Editor
  uploadingImage: boolean
}) {
  const state = useFormatState(editor)
  const run = (key: string) => () => BLOCK_BY_KEY[key].run(editor)

  return (
    <div className="border-line bg-surface/90 sticky top-14 z-20 flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 backdrop-blur">
      <BlockMenu editor={editor} blockKey={state.blockKey} />

      <ToolDivider />

      <ToolButton
        icon={Bold}
        label="굵게 (Ctrl+B)"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        icon={Italic}
        label="기울임 (Ctrl+I)"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        icon={Underline}
        label="밑줄 (Ctrl+U)"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
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
      <ColorMenu editor={editor} color={state.color} highlight={state.highlight} />

      <ToolDivider />

      <AlignMenu editor={editor} align={state.align} />

      <ToolDivider />

      <ToolButton
        icon={List}
        label="글머리 목록"
        active={state.blockKey === 'bulletList'}
        onClick={run('bulletList')}
      />
      <ToolButton
        icon={ListOrdered}
        label="번호 목록"
        active={state.blockKey === 'orderedList'}
        onClick={run('orderedList')}
      />
      <ToolButton
        icon={ListTodo}
        label="할 일 목록"
        active={state.blockKey === 'taskList'}
        onClick={run('taskList')}
      />

      <ToolDivider />

      <ToolButton
        icon={Quote}
        label="인용"
        active={state.blockKey === 'blockquote'}
        onClick={run('blockquote')}
      />
      <ToolButton
        icon={SquareCode}
        label="코드 블록"
        active={state.blockKey === 'codeBlock'}
        onClick={run('codeBlock')}
      />
      <ToolButton icon={Minus} label="구분선" onClick={run('horizontalRule')} />
      <ToolButton
        icon={uploadingImage ? LoaderCircle : ImagePlus}
        label={uploadingImage ? '사진 올리는 중…' : '사진'}
        disabled={uploadingImage}
        spinning={uploadingImage}
        onClick={run('image')}
      />
      <LinkMenu editor={editor} href={state.link} />
      <ToolButton
        icon={RemoveFormatting}
        label="서식 지우기"
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
      />

      <ToolDivider />

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
