import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { filterBlocks, type EditorBlock } from './editorBlocks'
import { SlashMenuList, type SlashListHandle } from './SlashMenuList'

/** 노션식 `/` 명령. 블록 목록은 툴바 드롭다운과 같은 정의를 공유한다. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<EditorBlock, EditorBlock>({
        editor: this.editor,
        char: '/',
        // 코드 블록 안에서는 `/` 가 그냥 문자다.
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: ({ query }) => filterBlocks(query),
        command: ({ editor, range, props }) => {
          // 입력한 `/명령` 을 지운 자리에 블록을 적용한다.
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => {
          let component: ReactRenderer<SlashListHandle> | null = null
          let unmount: (() => void) | null = null

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenuList, { props, editor: props.editor })
              unmount = props.mount(component.element)
            },
            onUpdate: (props) => {
              component?.updateProps(props)
            },
            onKeyDown: (props) => {
              // Esc는 플러그인이 직접 닫게 둔다.
              if (props.event.key === 'Escape') return false
              return component?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              unmount?.()
              component?.destroy()
              component = null
              unmount = null
            },
          }
        },
      }),
    ]
  },
})
