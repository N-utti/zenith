import { useCallback, useEffect, useRef } from 'react'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold,
  Code,
  Italic,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react'
import {
  AlignMenu,
  BlockMenu,
  ColorMenu,
  LinkMenu,
  ToolButton,
  ToolDivider,
} from './editorControls'
import { deleteSelectedBlocks } from './deleteBlocks'
import { useFormatState } from './editorFormats'

/** 「보여라」 신호를 보낼 때 쓰는 키. 안 주면 BubbleMenu 가 알 수 없는 키를 새로 만든다. */
const BUBBLE_KEY = new PluginKey('textBubble')

/** 커서만 놓인 상태, 코드 블록, 파일 칩만 고른 상태(칩은 누르면 골라진다)에서는 뜨지 않는다. */
function hasText(editor: Editor) {
  const { from, to } = editor.state.selection
  if (from === to || !editor.isEditable) return false
  return !editor.isActive('codeBlock') && !editor.isActive('fileChip')
}

/**
 * 마우스로 끌어 고르는 동안은 막대를 띄우지 않고, 버튼을 뗐을 때 최종 선택 자리에 한 번 띄운다.
 * 그대로 두면 선택이 늘 때마다 막대가 따라 움직인다. 떼는 순간에는 선택이 바뀌지 않아 막대가 스스로
 * 다시 보지 않으므로 「보여라」 신호를 보낸다.
 * 손가락은 빼 둔다. 아이폰은 길게 눌러 고를 때 뗀 신호가 안 오기도 해서, 막으면 막대가 영영 안 뜬다.
 */
function useMouseHeld(editor: Editor) {
  const held = useRef(false)
  useEffect(() => {
    const dom = editor.view.dom
    const release = (show: boolean) => {
      if (!held.current) return
      held.current = false
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      if (show && !editor.isDestroyed && hasText(editor)) {
        // 「show」 는 자리를 재고 나서 막대를 붙인다. 붙기 전에는 크기가 0 이라 자리가 틀어져서, 붙인 뒤 한 번 더 잰다.
        editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, 'show'))
        editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, 'updatePosition'))
      }
    }
    const onUp = () => release(true)
    // 뗀 신호가 안 오는 길: 끄는 도중 다른 창으로 가기(blur), 고른 글·그림을 끌어 옮기기(브라우저가
    // pointercancel 을 보내고 놓은 뒤 pointerup 은 없다). 붙잡힌 채로 남지 않게 푼다. 옮겨 놓은 뒤의
    // 선택은 막대가 스스로 보고 예전처럼 띄운다.
    const onCancel = () => release(false)
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      held.current = true
      // 편집기 밖에서 떼도 받는다(끌다가 본문 밖으로 나가는 일이 흔하다).
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('blur', onCancel)
    }
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('dragstart', onCancel)
    return () => {
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('dragstart', onCancel)
      release(false)
    }
  }, [editor])
  return held
}

/** 글자를 선택하면 그 자리에 뜨는 서식 막대. 노션의 선택 메뉴와 같은 역할. */
export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const state = useFormatState(editor)
  const held = useMouseHeld(editor)
  // 그릴 때마다 새 함수를 주면 BubbleMenu 가 그때마다 옵션 갱신 트랜잭션을 보낸다.
  const shouldShow = useCallback(
    ({ editor: e }: { editor: Editor }) => !held.current && hasText(e),
    [held],
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={BUBBLE_KEY}
      updateDelay={100}
      shouldShow={shouldShow}
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

      <ToolDivider />

      {/* 고른 글자가 아니라 그 글이 든 블록을 통째로 지운다(글자만 지우는 건 Backspace 로 충분하다).
          확인은 묻지 않는다. Ctrl+Z 한 번으로 돌아온다. */}
      <ToolButton
        icon={Trash2}
        label="블록 지우기"
        onClick={() =>
          editor
            .chain()
            .focus()
            .command(({ tr }) => deleteSelectedBlocks(tr))
            .run()
        }
      />
    </BubbleMenu>
  )
}
