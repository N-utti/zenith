import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { WifiOff } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { formatRelative } from '@/lib/datetime'
import { useTouchDoc } from './api'
import { CommentPanel } from './CommentPanel'
import { EditorToolbar } from './EditorToolbar'
import { hueToColor, useCollabStatus, useCollabTitle, usePresence } from './collabState'
import { useCollabSession, type CollabSession } from './useCollabSession'
import type { DocDetail } from './types'

/** 함께 보고 있는 사람들의 커서 색과 같은 색 아바타를 헤더에 세운다. */
function PresenceBar({ session }: { session: CollabSession }) {
  const users = usePresence(session.provider)
  const status = useCollabStatus(session.provider)

  if (status !== 'connected') {
    return (
      <p
        title="npm run collab 로 실시간 릴레이를 켜면 다른 사람과 함께 편집할 수 있습니다."
        className="text-warning flex items-center gap-1.5 text-xs"
      >
        <WifiOff className="size-3.5" />
        오프라인 편집 중 — 이 브라우저에만 저장됩니다
      </p>
    )
  }

  if (users.length === 0) {
    return <p className="text-subtle text-xs">실시간 연결됨</p>
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {users.slice(0, 4).map((user) => (
          <span
            key={user.clientId}
            title={user.name}
            className="border-surface grid size-6 place-items-center rounded-full border-2 text-[10px] font-semibold text-white"
            style={{ backgroundColor: user.color }}
          >
            {user.name.slice(1, 2) || user.name.slice(0, 1)}
          </span>
        ))}
      </div>
      <span className="text-subtle text-xs">{users.length}명 편집 중</span>
    </div>
  )
}

function DocSurface({ session, meta }: { session: CollabSession; meta: DocDetail }) {
  const user = useCurrentUser()
  const { doc, provider } = session
  const { title, setTitle } = useCollabTitle(doc, meta.title)
  const { mutate: touchDoc } = useTouchDoc(meta.id)

  const editor = useEditor({
    extensions: [
      // undoRedo는 꺼야 한다. Yjs UndoManager가 대신하며, 그래야 되돌리기가
      // 남의 편집까지 지우지 않고 내 변경만 되돌린다.
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({ placeholder: '내용을 입력하세요…' }),
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({
        provider,
        user: { name: user.name, color: hueToColor(user.avatarHue) },
      }),
    ],
    editorProps: {
      attributes: { class: 'moa-editor outline-none' },
    },
    onCreate: ({ editor: created }) => {
      // 서버가 Yjs 초기 상태를 주기 전까지의 임시 경로. 문서를 처음 여는
      // 탭에서만 초안을 심는다.
      if (session.isEmpty && meta.seedHtml) {
        created.commands.setContent(meta.seedHtml)
      }
    },
  })

  // 제목의 원천도 Y.Doc이다. 비어 있으면 서버 사본으로 한 번 채운다.
  useEffect(() => {
    const metaMap = doc.getMap<string>('meta')
    if (metaMap.get('title') === undefined) metaMap.set('title', meta.title)
  }, [doc, meta.title])

  // 편집이 멎으면 목록·검색이 볼 사본(제목·수정시각)을 갱신한다.
  useEffect(() => {
    let timer: number | undefined
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      // 다른 탭에서 넘어온 변경은 그 탭이 이미 반영한다.
      if (origin === provider) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        touchDoc(doc.getMap<string>('meta').get('title'))
      }, 1500)
    }
    doc.on('update', onUpdate)
    return () => {
      window.clearTimeout(timer)
      doc.off('update', onUpdate)
    }
  }, [doc, provider, touchDoc])

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        {editor && <EditorToolbar editor={editor} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="mb-1 flex items-center justify-between gap-4">
              <p className="text-subtle text-xs">
                <Avatar
                  name={meta.editorName}
                  hue={meta.editorHue}
                  size="sm"
                  className="mr-1.5 align-middle"
                />
                {meta.editorName} · {formatRelative(meta.updatedAt)} 수정
              </p>
              {session && <PresenceBar session={session} />}
            </div>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 없는 문서"
              aria-label="문서 제목"
              className="text-fg placeholder:text-subtle w-full bg-transparent py-2 text-3xl font-bold tracking-tight outline-none"
            />

            {editor ? (
              <EditorContent editor={editor} className="mt-4" />
            ) : (
              <Spinner className="mt-6" />
            )}
          </div>
        </div>
      </div>

      <CommentPanel docId={meta.id} />
    </div>
  )
}

export function DocWorkspace({ meta }: { meta: DocDetail }) {
  const session = useCollabSession(meta.id)

  if (!session) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return <DocSurface session={session} meta={meta} />
}
