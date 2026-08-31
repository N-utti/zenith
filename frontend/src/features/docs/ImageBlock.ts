import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageBlockView } from './ImageBlockView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      setImageBlock: (attrs: { src: string; alt?: string }) => ReturnType
    }
  }
}

/**
 * 툴바·슬래시 메뉴가 "파일 선택 창을 열어 달라"고 알리는 신호.
 *
 * 업로드는 에디터를 만든 뒤에야 준비되는데 확장은 만들 때 굳는다. 확장이나
 * 에디터에 콜백을 심는 대신 에디터 DOM에 이벤트를 쏘고, useImageUpload가 받는다.
 */
export const PICK_IMAGE_EVENT = 'zenith:pick-image'

/** figure 안의 img에서 값을 읽는다. 바깥에서 붙여넣은 맨 <img> 도 같은 함수로 처리된다. */
function fromImg(element: HTMLElement, name: string): string | null {
  return element.querySelector('img')?.getAttribute(name) ?? element.getAttribute(name)
}

/**
 * 사진 블록. 캡션은 속성이 아니라 노드 내용(inline*)이다 —
 * 그래야 두 사람이 동시에 캡션을 고쳐도 Yjs가 글자 단위로 합쳐 준다.
 *
 * 이미지 자체는 문서에 담지 않는다. src에는 `/api/files/{id}` URL만 들어간다.
 */
export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  content: 'inline*',
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null, parseHTML: (el) => fromImg(el, 'src') },
      alt: { default: null, parseHTML: (el) => fromImg(el, 'alt') },
      width: {
        default: null,
        parseHTML: (el) => {
          const value = fromImg(el, 'width')
          return value ? Number(value) : null
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'figure[data-type="imageBlock"]', contentElement: 'figcaption' },
      { tag: 'img[src]' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'imageBlock' }),
      ['img', { src: node.attrs.src, alt: node.attrs.alt, width: node.attrs.width || undefined }],
      ['figcaption', 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView)
  },

  addCommands() {
    return {
      setImageBlock:
        (attrs) =>
        ({ chain, state }) => {
          // 커서가 문단 가운데 있어도 문단을 쪼개지 않는다. 지금 있는 최상위
          // 블록 바로 뒤에 세우고, 커서는 캡션으로 옮겨 바로 적을 수 있게 한다.
          const { $from } = state.selection
          const at = $from.depth > 0 ? $from.after(1) : state.doc.content.size

          return chain()
            .insertContentAt(at, { type: this.name, attrs })
            .setTextSelection(at + 1)
            .run()
        },
    }
  },
})
