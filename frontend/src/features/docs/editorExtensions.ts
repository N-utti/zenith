import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { ImageBlock } from './ImageBlock'
import { SlashCommand } from './slashCommand'
import type { CollabSession } from './useCollabSession'

type BuildOptions = Pick<CollabSession, 'doc' | 'provider'> & {
  user: { name: string; color: string }
}

/** 커서를 올려 둔 빈 줄에만 안내를 띄운다. 노션처럼 조용하게. */
function placeholderFor({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } }) {
  if (node.type.name === 'heading') return `제목 ${node.attrs.level}`
  if (node.type.name === 'imageBlock') return '사진 설명 (선택)'
  if (node.type.name === 'codeBlock') return ''
  return "내용을 입력하거나 '/' 를 눌러 블록을 고르세요"
}

/**
 * 문서 에디터가 쓰는 확장 묶음.
 * 협업(Yjs)이 문서의 원천이므로 되돌리기는 StarterKit이 아니라 Yjs UndoManager가 맡는다.
 */
export function buildDocExtensions({ doc, provider, user }: BuildOptions): Extensions {
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
    TextStyleKit.configure({ backgroundColor: false, fontFamily: false, fontSize: false, lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ImageBlock,

    SlashCommand,
    Placeholder.configure({ placeholder: placeholderFor }),

    Collaboration.configure({ document: doc }),
    CollaborationCaret.configure({ provider, user }),
  ]
}
