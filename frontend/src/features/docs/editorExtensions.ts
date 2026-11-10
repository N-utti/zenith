import { Extension, getStyleProperty, type Extensions } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { BlockId } from './blockId'
import {
  BlockFormat,
  SafeColor,
  SafeFontFamily,
  SafeFontSize,
  SafeTextAlign,
  safeColor,
} from './docFormat'
import { safeHref } from './exportContent'
import { FileChip } from './FileChip'
import { openExternal } from '@/lib/desktop'
import { ImageBlock } from './ImageBlock'
import { SlashCommand } from './slashCommand'
import { tableExtensions } from './tableExtensions'
import type { CollabSession } from './useCollabSession'

// 형광펜 색. 값을 거르는 까닭은 docFormat.ts 와 같다.
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

/**
 * 링크를 누르면 연다(편집 중에도). tiptap 의 openOnClick 은 noopener 없이 `window.open` 하고,
 * mouseup 에서 불려 click 기본 동작이 살아남아 데스크톱 셸의 전역 처리기가 한 번 더 연다.
 * 그래서 click 을 직접 받아 막고 연다. 끌어서 고른 끝이 링크면 열지 않는다.
 * href 는 원래 값을 읽는다. 걸러져 빈 href 를 `anchor.href` 로 풀면 지금 페이지 주소가 된다.
 */
const OpenLinkOnClick = Extension.create({
  name: 'openLinkOnClick',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              if (event.button !== 0 || !view.state.selection.empty) return false
              const anchor =
                event.target instanceof Element ? event.target.closest('a[href]') : null
              // 링크 서식만. 파일 칩의 내려받기 링크 같은 노드 뷰 안 링크는 그쪽이 처리한다.
              if (!(anchor instanceof HTMLAnchorElement)) return false
              if (anchor.closest('[data-node-view-wrapper]')) return false
              const href = safeHref(anchor.getAttribute('href'))
              if (!href) return false
              event.preventDefault()
              openExternal(href)
              return true
            },
          },
        },
      }),
    ]
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
        openOnClick: false, // 아래 OpenLinkOnClick 이 연다
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    OpenLinkOnClick,

    // 서식 확장. 툴바·버블 메뉴가 쓰는 것들. 색·글꼴·크기는 값을 거르는 판(docFormat)으로 갈아 끼운다.
    TextStyleKit.configure({
      backgroundColor: false,
      color: false,
      fontFamily: false,
      fontSize: false,
      lineHeight: false,
    }),
    SafeColor,
    SafeFontFamily,
    SafeFontSize,
    BlockFormat,
    SafeHighlight.configure({ multicolor: true }),
    SafeTextAlign.configure({ types: ['heading', 'paragraph'] }),
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
