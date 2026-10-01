import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { FileChipView } from './FileChipView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileChip: {
      setFileChip: (attrs: { src: string; name: string; size: number }) => ReturnType
    }
  }
}

/** 툴바·슬래시 메뉴가 "파일 선택 창을 열어 달라"고 알리는 신호. 사진(`PICK_IMAGE_EVENT`)과 같은 방식이다. */
export const PICK_FILE_EVENT = 'zenith:pick-file'

/**
 * 파일 칩. 글줄 안에 들어가는 한 덩어리(inline atom)라 문단·목록·표 칸 어디에나 놓인다.
 * 사진과 마찬가지로 파일 자체는 문서에 담지 않는다. `src` 에는 `/api/files/{id}` 만 들어간다.
 * ponytail: 칩만 끌어 옮기기는 없다. 잘라 붙이거나 손잡이로 줄째 옮긴다.
 */
export const FileChip = Node.create({
  name: 'fileChip',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      // 읽는 법을 안 주면 TipTap 이 `007`·`true` 같은 이름을 숫자·참거짓으로 바꿔 읽는다.
      name: { default: '', parseHTML: (el) => el.getAttribute('name') ?? '' },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('size')) || 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="fileChip"]' }]
  },

  // 바깥 앱에 붙여넣으면 파일 이름이 글자로 남는다. 이름은 남의 편집(Y.Doc)에서도 오므로 글자로 못박는다.
  // 글자가 아닌 값이 그대로 가면 ProseMirror 가 태그 명세로 읽어 복사가 죽는다.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'fileChip' }),
      String(node.attrs.name ?? ''),
    ]
  },

  renderText({ node }) {
    return String(node.attrs.name ?? '')
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileChipView)
  },

  addCommands() {
    return {
      setFileChip:
        (attrs) =>
        ({ commands, state }) => {
          // 선택한 글·블록을 덮어쓰지 않고 그 끝에 넣는다. 사진 블록과 같은 약속이다.
          const { $to } = state.selection
          const chip = { type: this.name, attrs }
          const parent = $to.parent
          const inCaption = parent.type.name === 'imageBlock'
          if (parent.inlineContent && !parent.type.spec.code && !inCaption) {
            return commands.insertContentAt($to.pos, chip)
          }
          // 글줄이 아닌 자리(블록을 통째로 고름)에서는 그 뒤에 새 문단으로 세운다. 코드 블록은 칩을
          // 못 받아 둘로 쪼개지고, 사진 설명에 넣은 칩은 사진을 지울 때 같이 지워진다. 둘 다 블록 뒤로 뺀다.
          const at = parent.inlineContent ? $to.after() : $to.pos
          return commands.insertContentAt(at, { type: 'paragraph', content: [chip] })
        },
    }
  },
})
