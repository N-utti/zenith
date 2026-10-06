import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageBlockView } from './ImageBlockView'
import { uploadedFilePath } from '@/lib/links'
import { serverOrigin } from '@/lib/serverOrigin'

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
 * 에디터에 콜백을 심는 대신 에디터 DOM에 이벤트를 쏘고, useFileUpload가 받는다.
 */
export const PICK_IMAGE_EVENT = 'zenith:pick-image'

/**
 * 붙여넣은 그림 주소를 올린 파일 경로로. 같은 서버의 절대 주소(`https://서버/api/files/{id}`)는 경로만
 * 남긴다(브라우저가 상대 주소를 절대 주소로 바꿔 복사하는 경우가 있다). 그 밖은 `null`.
 */
function fileSrc(raw: string | null): string | null {
  if (!raw) return null
  for (const origin of [window.location.origin, serverOrigin()]) {
    if (origin && raw.startsWith(`${origin}/`)) return uploadedFilePath(raw.slice(origin.length))
  }
  return uploadedFilePath(raw)
}

/** figure 안의 img에서 값을 읽는다. 바깥에서 붙여넣은 맨 <img> 도 같은 함수로 처리된다. */
function fromImg(element: HTMLElement, name: string): string | null {
  return element.querySelector('img')?.getAttribute(name) ?? element.getAttribute(name)
}

/**
 * 사진 블록. 캡션은 속성이 아니라 노드 내용(inline*)이다.
 * 그래야 두 사람이 동시에 캡션을 고쳐도 Yjs가 글자 단위로 합쳐 준다.
 *
 * 이미지 자체는 문서에 담지 않는다. src에는 `/api/files/{id}` URL만 들어간다.
 *
 * **그 모양이 아닌 주소는 받지도 그리지도 않는다**(`uploadedFilePath`). 붙여넣은 HTML, 남의 편집
 * (Y.Doc), 버전 미리보기로 `https://바깥/…` 가 들어오면 그 문서를 여는 사람마다 바깥으로 요청이
 * 나간다. 웹은 보안 정책 헤더가 막지만 데스크톱 앱은 막지 않는다. 파일 칩과 같은 규칙이다.
 */
export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  content: 'inline*',
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      // 세 값은 아래 renderHTML 이 안쪽 <img> 에 직접 싣는다. 바깥 <figure> 에는 싣지 않는다
      // (renderHTML 을 비워 두면 확장이 figure 에도 그대로 붙인다. 걸러지지 않은 src 까지).
      src: {
        default: null,
        parseHTML: (el) => fileSrc(fromImg(el, 'src')),
        renderHTML: () => ({}),
      },
      alt: { default: null, parseHTML: (el) => fromImg(el, 'alt'), renderHTML: () => ({}) },
      width: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: (el) => {
          const value = fromImg(el, 'width')
          return value ? Number(value) : null
        },
      },
    }
  },

  parseHTML() {
    return [
      // 올린 파일이 아닌 그림은 붙여넣어도 사진 블록으로 만들지 않는다. figure 로 와도 같다(캡션
      // 글은 문단으로 남는다). 빈 사진 블록을 만들면 내보내기에서 사진 자리만 남는다.
      {
        tag: 'figure[data-type="imageBlock"]',
        contentElement: 'figcaption',
        getAttrs: (el) => (fileSrc(fromImg(el as HTMLElement, 'src')) ? null : false),
      },
      {
        tag: 'img[src]',
        getAttrs: (el) => (fileSrc((el as HTMLElement).getAttribute('src')) ? null : false),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'imageBlock' }),
      [
        'img',
        {
          src: uploadedFilePath(node.attrs.src),
          alt: node.attrs.alt,
          width: node.attrs.width || undefined,
        },
      ],
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
          // 블록을 통째로 고른 상태(깊이 0)에서는 그 블록 뒤다.
          const { $from, to } = state.selection
          const at = $from.depth > 0 ? $from.after(1) : to

          return chain()
            .insertContentAt(at, { type: this.name, attrs })
            .setTextSelection(at + 1)
            .run()
        },
    }
  },
})
