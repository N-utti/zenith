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
import {
  AlignMenu,
  BlockMenu,
  ColorMenu,
  LinkMenu,
  ToolButton,
  ToolDivider,
} from './editorControls'
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

      {/* 05·SCR-08: 모바일 서식 툴바는 한 줄이다. 좁은 폭에서 스무 개를 늘어놓으면 세 줄로
          접히며 본문 자리를 먹는다.
          정본은 «가로 스크롤» 로 한 줄을 만들라고 하지만 그 길이 지금 막혀 있다: 툴바에
          overflow-x 를 걸면 세로도 같이 잘려 ToolMenu 의 absolute 팝오버(블록 종류·색·정렬·
          링크)가 사라진다. 팝오버를 포털로 빼는 건 이 변경의 범위 밖이라, 한 줄은 숨김으로
          만들었다. 팝오버가 포털로 옮겨지면 여기를 가로 스크롤로 되돌린다.
          숨긴 것은 모두 좁은 폭에서도 다른 경로로 닿는다: 밑줄·취소선·인라인 코드·색·정렬·
          서식 지우기는 글자를 고르면 뜨는 풍선 메뉴(EditorBubbleMenu), 목록·인용·코드 블록은
          블록 종류 메뉴, 구분선은 `/` 명령.
          ponytail: 남는 것이 약 326px 라 320px 폭에서는 여전히 두 줄이 된다. 가로 스크롤로
          되돌릴 때 같이 풀린다. */}
      <div className="hidden lg:contents">
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
      </div>

      <ToolButton
        icon={ListTodo}
        label="할 일 목록"
        active={state.blockKey === 'taskList'}
        onClick={run('taskList')}
      />

      <div className="hidden lg:contents">
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
      </div>

      <ToolButton
        icon={uploadingImage ? LoaderCircle : ImagePlus}
        label={uploadingImage ? '사진 올리는 중…' : '사진'}
        disabled={uploadingImage}
        spinning={uploadingImage}
        onClick={run('image')}
      />
      <LinkMenu editor={editor} href={state.link} />

      <div className="hidden lg:contents">
        <ToolButton
          icon={RemoveFormatting}
          label="서식 지우기"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        />
      </div>

      <ToolDivider />

      {/* 되돌리기는 Yjs UndoManager가 담당한다. 남의 편집은 건드리지 않고 내 것만 되돌린다. */}
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
