import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Italic, RemoveFormatting, Strikethrough, Underline } from 'lucide-react'
import {
  AlignMenu,
  BlockMenu,
  ColorMenu,
  LinkMenu,
  ToolButton,
  ToolDivider,
} from './editorControls'
import { useFormatState } from './editorFormats'

/** 글자를 선택하면 그 자리에 뜨는 서식 막대. 노션의 선택 메뉴와 같은 역할. */
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
      // 좁은 폭에서는 한 줄에 다 못 들어간다. 떠 있는 막대라 두 줄이 돼도 본문을 먹지 않으므로
      // 접히게 두고, 화면 밖으로 밀려 가로 스크롤이 생기는 것만 막는다.
      className="border-line bg-surface flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-0.5 rounded-xl border p-1 shadow-lg"
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

      {/* 좁은 폭에서는 위 서식 툴바가 이 둘을 접는다(EditorToolbar). 여기 없으면 모바일에서는
          데스크톱이 가운데 정렬해 둔 문단을 되돌릴 길도, 붙여넣기로 딸려 온 서식을 지울 길도
          없다. 데스크톱에서는 툴바와 겹치지만 겹쳐서 해로울 것은 없다. */}
      <AlignMenu editor={editor} align={state.align} />
      <ToolButton
        icon={RemoveFormatting}
        label="서식 지우기"
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
      />
    </BubbleMenu>
  )
}
