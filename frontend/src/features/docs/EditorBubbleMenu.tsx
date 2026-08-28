import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Italic, Strikethrough, Underline } from 'lucide-react'
import { BlockMenu, ColorMenu, LinkMenu, ToolButton, ToolDivider } from './editorControls'
import { useFormatState } from './editorFormats'

/** 글자를 선택하면 그 자리에 뜨는 서식 막대 — 노션의 선택 메뉴와 같은 역할. */
export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const state = useFormatState(editor)

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={100}
      shouldShow={({ editor: e, from, to }) => {
        // 커서만 놓인 상태에서는 뜨지 않는다. 코드 블록 안에서는 서식이 의미가 없다.
        if (from === to || !e.isEditable) return false
        return !e.isActive('codeBlock')
      }}
      className="border-line bg-surface flex items-center gap-0.5 rounded-xl border p-1 shadow-lg"
    >
      <BlockMenu editor={editor} blockKey={state.blockKey} />

      <ToolDivider />

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
        icon={Underline}
        label="밑줄"
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

      <ToolDivider />

      <ColorMenu editor={editor} color={state.color} highlight={state.highlight} />
      <LinkMenu editor={editor} href={state.link} />
    </BubbleMenu>
  )
}
