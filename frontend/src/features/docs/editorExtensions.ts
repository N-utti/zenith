import { getStyleProperty, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { BlockId } from './blockId'
import { FileChip } from './FileChip'
import { ImageBlock } from './ImageBlock'
import { SlashCommand } from './slashCommand'
import { tableExtensions } from './tableExtensions'
import type { CollabSession } from './useCollabSession'

/**
 * 형광펜 색으로 받을 값. 16진수, `rgb()`·`rgba()`, 색 이름만. 원래 확장은 붙여넣은 HTML 의
 * `data-color` 를 그대로 `style="background-color: …"` 에 써서, `red;background-image:url(https://바깥/…)`
 * 같은 값을 끼우면 문서를 여는 사람마다 바깥으로 요청이 나간다(데스크톱 앱은 막지 않는다).
 */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i
const safeColor = (value: unknown) =>
  typeof value === 'string' && SAFE_COLOR.test(value.trim()) ? value.trim() : null

const SafeHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        // 원래 확장처럼 style 의 원래 표기(`#fef08a`)를 먼저 읽는다. `el.style` 은 rgb() 로 바꿔 준다.
        parseHTML: (el) =>
          safeColor(
            el.getAttribute('data-color') ||
              getStyleProperty(el, 'background-color') ||
              el.style.backgroundColor,
          ),
        // 남의 편집(Y.Doc)으로 들어온 값도 그릴 때 다시 거른다.
        renderHTML: (attrs) => {
          const color = safeColor(attrs.color)
          return color
            ? { 'data-color': color, style: `background-color: ${color}; color: inherit` }
            : {}
        },
      },
    }
  },
})

type BuildOptions = Pick<CollabSession, 'doc' | 'provider'> & {
  user: { name: string; color: string }
}

/** 커서를 올려 둔 빈 줄에만 안내를 띄운다. 노션처럼 조용하게. */
function placeholderFor({
  node,
}: {
  node: { type: { name: string }; attrs: Record<string, unknown> }
}) {
  if (node.type.name === 'heading') return `제목 ${node.attrs.level}`
  if (node.type.name === 'imageBlock') return '사진 설명 (선택)'
  if (node.type.name === 'codeBlock') return ''
  return "내용을 입력하거나 '/' 를 눌러 블록을 고르세요"
}

/**
 * 문서 내용을 이루는 확장. 편집기와 버전 미리보기가 같이 쓴다.
 * 미리보기에 하나라도 빠지면 그 노드가 든 버전은 통째로 빈 문단이 된다(tiptap 이 Invalid content 로 버림).
 */
export function docContentExtensions(): Extensions {
  return [
    // undoRedo는 꺼야 한다. Yjs UndoManager가 대신하며, 그래야 되돌리기가
    // 남의 편집까지 지우지 않고 내 변경만 되돌린다.
    StarterKit.configure({
      undoRedo: false,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),

    // 서식 확장. 툴바·버블 메뉴가 쓰는 것들.
    TextStyleKit.configure({
      backgroundColor: false,
      fontFamily: false,
      fontSize: false,
      lineHeight: false,
    }),
    SafeHighlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      // 기본값은 영어("Task item checkbox for …")라 스크린리더가 영어로 읽는다.
      a11y: { checkboxLabel: (node) => `할 일: ${node.textContent || '빈 항목'}` },
    }),
    ...tableExtensions(),
    ImageBlock,
    FileChip,
    // 댓글 닻. 미리보기에도 있어야 버전을 되돌릴 때 닻이 살아남는다.
    BlockId,

    SlashCommand,
    Placeholder.configure({ placeholder: placeholderFor }),
  ]
}

/**
 * 문서 에디터가 쓰는 확장 묶음.
 * 협업(Yjs)이 문서의 원천이므로 되돌리기는 StarterKit이 아니라 Yjs UndoManager가 맡는다.
 */
export function buildDocExtensions({ doc, provider, user }: BuildOptions): Extensions {
  return [
    ...docContentExtensions(),
    Collaboration.configure({ document: doc }),
    CollaborationCaret.configure({ provider, user }),
  ]
}
