import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { GripVertical, WifiOff, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useDragAutoScroll } from '@/lib/useDragAutoScroll'
import { useSaveVersion, useTouchDoc } from './api'
import { CommentPanel } from './CommentPanel'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { buildDocExtensions } from './editorExtensions'
import { EditorToolbar } from './EditorToolbar'
import { VersionPanel } from './VersionPanel'
import { VersionPreview } from './VersionPreview'
import { hueToColor, useCollabStatus, useCollabTitle, usePresence } from './collabState'
import { readSnapshot, takeSnapshot, type RestoredContent } from './versioning'
import { useCollabSession, type CollabSession } from './useCollabSession'
import { useImageUpload } from './useImageUpload'
import type { DocDetail, DocVersion } from './types'

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

  // 혼자일 때 "1명 편집 중"은 알려 주는 게 없다. 그때는 연결 상태를 띄운다.
  if (users.length < 2) {
    return <p className="text-subtle text-xs">실시간 연결됨</p>
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {users.slice(0, 4).map((user) => (
          <span
            key={user.clientId}
            title={user.isSelf ? `${user.name} (나)` : user.name}
            className={cn(
              'border-surface grid size-6 place-items-center rounded-full border-2 text-[10px] font-semibold text-white',
              // 어느 색이 내 커서인지 대조할 수 있게 본인을 표시한다.
              user.isSelf && 'ring-accent/50 ring-2',
            )}
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

/** 댓글과 버전 기록이 같은 자리를 나눠 쓴다. */
function DocSidebar({
  tab,
  onTabChange,
  children,
}: {
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  children: ReactNode
}) {
  const TABS: { key: SidebarTab; label: string }[] = [
    { key: 'comments', label: '댓글' },
    { key: 'versions', label: '버전 기록' },
  ]

  return (
    <aside className="border-line bg-surface flex min-h-0 w-full flex-col border-t lg:w-80 lg:border-t-0 lg:border-l">
      <div className="border-line flex border-b">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              tab === key
                ? 'border-accent text-fg'
                : 'text-muted hover:text-fg border-transparent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </aside>
  )
}

type SidebarTab = 'comments' | 'versions'

/** 문단 왼쪽에 뜨는 손잡이. 끌어서 블록을 옮기고, 누르면 그 블록을 통째로 고른다. */
function BlockDragHandle({ editor }: { editor: Editor }) {
  const posRef = useRef(-1)

  return (
    <DragHandle
      editor={editor}
      nested
      onNodeChange={({ pos }) => {
        posRef.current = pos
      }}
      className="pr-1"
    >
      <button
        type="button"
        title="드래그해서 옮기기 · 클릭해서 블록 선택"
        aria-label="블록 손잡이"
        className="text-subtle hover:bg-surface-hover hover:text-muted grid size-6 cursor-grab place-items-center rounded active:cursor-grabbing"
        onClick={() => {
          if (posRef.current < 0) return
          editor.chain().focus().setNodeSelection(posRef.current).run()
        }}
      >
        <GripVertical className="size-4" />
      </button>
    </DragHandle>
  )
}

function DocSurface({ session, meta }: { session: CollabSession; meta: DocDetail }) {
  const user = useCurrentUser()
  const { doc, provider } = session
  const { title, setTitle } = useCollabTitle(doc, meta.title)
  const { mutate: touchDoc } = useTouchDoc(meta.id)
  const { mutate: saveVersion, isPending: savingVersion } = useSaveVersion(meta.id)

  const [tab, setTab] = useState<SidebarTab>('comments')
  const [preview, setPreview] = useState<{ version: DocVersion; content: RestoredContent } | null>(
    null,
  )
  const [previewError, setPreviewError] = useState<string | null>(null)

  const editor = useEditor({
    extensions: buildDocExtensions({
      doc,
      provider,
      user: { name: user.name, color: hueToColor(user.avatarHue) },
    }),
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

  const { uploading, error: imageError, clearError } = useImageUpload(editor)

  // 사진을 끌어 옮길 때 화면 끝에 닿으면 본문이 그 방향으로 굴러야 한다.
  const scrollRef = useRef<HTMLDivElement>(null)
  useDragAutoScroll(scrollRef)

  // 제목의 원천도 Y.Doc이다. 비어 있으면 서버 사본으로 한 번 채운다.
  useEffect(() => {
    const metaMap = doc.getMap<string>('meta')
    if (metaMap.get('title') === undefined) metaMap.set('title', meta.title)
  }, [doc, meta.title])

  // 편집이 멎으면 목록·검색이 볼 사본(제목·수정시각)을 갱신하고 버전을 남긴다.
  // 버전은 서버가 합쳐 준다 — 같은 사람이 이어서 편집하는 동안은 하나로 접힌다.
  useEffect(() => {
    let metaTimer: number | undefined
    let versionTimer: number | undefined

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      // 다른 탭·다른 사람에게서 온 변경은 그쪽에서 이미 반영한다.
      if (origin === provider) return

      window.clearTimeout(metaTimer)
      metaTimer = window.setTimeout(() => {
        touchDoc(doc.getMap<string>('meta').get('title'))
      }, 1500)

      window.clearTimeout(versionTimer)
      versionTimer = window.setTimeout(() => {
        saveVersion({ snapshot: takeSnapshot(doc) })
      }, 5000)
    }

    doc.on('update', onUpdate)
    return () => {
      window.clearTimeout(metaTimer)
      window.clearTimeout(versionTimer)
      doc.off('update', onUpdate)
    }
  }, [doc, provider, touchDoc, saveVersion])

  const openPreview = (version: DocVersion | null) => {
    setPreviewError(null)
    if (!version) return setPreview(null)
    try {
      setPreview({ version, content: readSnapshot(doc, version.snapshot) })
    } catch {
      // 이 기능이 붙기 전에 만들어진 문서는 삭제 이력이 이미 수거돼 복원할 수 없다.
      setPreview(null)
      setPreviewError('이 버전은 복원할 수 없습니다. 기록 보존 설정 이전에 만들어진 문서입니다.')
    }
  }

  const restore = () => {
    if (!editor || !preview) return
    // 되감기가 아니라 새 편집이다. 그래야 접속 중인 다른 사람과도 같은
    // 결과로 수렴하고, 되돌리기 자체를 Ctrl+Z로 취소할 수 있다.
    editor.commands.setContent(preview.content.json)
    if (preview.content.title !== undefined) {
      doc.getMap<string>('meta').set('title', preview.content.title)
    }
    saveVersion({ snapshot: takeSnapshot(doc), label: '되돌림' })
    setPreview(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {preview ? (
        <VersionPreview
          version={preview.version}
          content={preview.content}
          onRestore={restore}
          onClose={() => setPreview(null)}
          restoring={savingVersion}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {editor && <EditorToolbar editor={editor} uploadingImage={uploading} />}

          {imageError && (
            <p
              role="alert"
              className="text-danger bg-danger/10 flex items-center gap-2 px-4 py-2 text-xs"
            >
              <span className="flex-1">{imageError}</span>
              <button
                type="button"
                aria-label="알림 닫기"
                onClick={clearError}
                className="cursor-pointer rounded p-0.5 hover:bg-black/5"
              >
                <X className="size-3.5" />
              </button>
            </p>
          )}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
                <PresenceBar session={session} />
              </div>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목 없는 문서"
                aria-label="문서 제목"
                className="text-fg placeholder:text-subtle w-full bg-transparent py-2 text-3xl font-bold tracking-tight outline-none"
              />

              {editor ? (
                <>
                  <EditorBubbleMenu editor={editor} />
                  <BlockDragHandle editor={editor} />
                  <EditorContent editor={editor} className="mt-4" />
                </>
              ) : (
                <Spinner className="mt-6" />
              )}
            </div>
          </div>
        </div>
      )}

      <DocSidebar tab={tab} onTabChange={setTab}>
        {tab === 'comments' ? (
          <CommentPanel docId={meta.id} />
        ) : (
          <>
            {previewError && (
              <p role="alert" className="text-danger bg-danger/10 m-2 rounded-lg px-3 py-2 text-xs">
                {previewError}
              </p>
            )}
            <VersionPanel
              docId={meta.id}
              selectedId={preview?.version.id ?? null}
              onSelect={openPreview}
            />
          </>
        )}
      </DocSidebar>
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
