import { hueOf } from '@/lib/avatar'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import DragHandle, { type DragHandleProps } from '@tiptap/extension-drag-handle-react'
import {
  ChevronDown,
  GripVertical,
  MessageSquarePlus,
  Sparkles,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useDragAutoScroll } from '@/lib/useDragAutoScroll'
import {
  UNTITLED_DOC,
  useSaveVersion,
  useSetAiSource,
  useTouchDoc,
  useVersionSnapshot,
} from './api'
import { BlockComments } from './BlockComments'
import { anchorBlock, flashBlock, flashElement } from './blockId'
import { CommentPanel } from './CommentPanel'
import { DocAskPanel } from './DocAskPanel'
import { DocCheckPanel } from './DocCheckPanel'
import { DocBreadcrumb } from './DocBreadcrumb'
import { DocWidthMenu } from './DocWidthMenu'
import { findText } from './findText'
import { tableBleedRef } from './tableBleed'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { ExportMenu } from './ExportMenu'
import { InlineAiPopover } from './InlineAiPopover'
import { buildDocExtensions } from './editorExtensions'
import { EditorToolbar } from './EditorToolbar'
import { TableRowMenu } from './TableRowMenu'
import { TrashDocModal } from './TrashDocModal'
import { VersionPanel } from './VersionPanel'
import { VersionPreview } from './VersionPreview'
import {
  WIDTH_ORIGIN,
  hueToColor,
  useCollabStatus,
  useCollabTitle,
  useCollabWidth,
  usePresence,
} from './collabState'
import { readSnapshot, takeSnapshot, type RestoredContent } from './versioning'
import { useCollabSession, type CollabSession } from './useCollabSession'
import { useFileUpload } from './useFileUpload'
import type { DocDetail, DocVersion } from './types'

/** 함께 보고 있는 사람들의 커서 색과 같은 색 아바타를 헤더에 세운다. */
function PresenceBar({ session }: { session: CollabSession }) {
  const users = usePresence(session.provider)
  const status = useCollabStatus(session.provider)

  if (status !== 'connected') {
    return (
      <p
        title="릴레이에 연결되면 다른 사람과 함께 편집됩니다. 개발 중이면 npm run server, 로그인이 풀렸으면 다시 로그인하세요."
        className="text-warning flex items-center gap-1.5 text-xs"
      >
        <WifiOff className="size-3.5" />
        {/* 사본 없이 연 세션은 편집이 이 화면의 메모리에만 있다. 다른 문서로 옮겨도 사라진다. */}
        {session.persistent
          ? '오프라인 편집 중. 이 브라우저에만 저장됩니다'
          : '오프라인 편집 중. 이 문서를 닫거나 새로고침하면 사라집니다'}
      </p>
    )
  }

  // 혼자일 때 "1명 편집 중"은 알려 주는 게 없다. 그때는 연결 상태를 띄운다.
  if (users.length < 2) {
    return <p className="text-subtle text-xs">실시간 연결됨</p>
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-2">
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

/**
 * 댓글과 버전 기록, 이 문서에 대한 AI 질문이 같은 자리를 나눠 쓴다.
 *
 * 데스크톱에서는 본문 오른쪽 320px 에 늘 펼쳐져 있다. 모바일에서는 본문 아래로 내려오는데,
 * 늘 펼쳐 두면 본문이 화면의 1/3 로 줄어든다. 그래서 좁은 폭에서는 탭 줄만 남기고 접어 두고,
 * 탭을 눌러 펼친다(같은 탭을 다시 누르면 접힌다).
 */
function DocSidebar({
  tab,
  onTabChange,
  open,
  onOpenChange,
  onCollapse,
  children,
}: {
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  /** 좁은 폭에서 펼쳐져 있는지. 알림으로 들어올 때 바깥에서 펼친다. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 좁은 폭에서 접을 때. 본문을 넓게 보려는 것이므로 본문을 가린 미리보기도 같이 닫는다. */
  onCollapse: () => void
  children: ReactNode
}) {
  const TABS: { key: SidebarTab; label: string }[] = [
    { key: 'comments', label: '댓글' },
    { key: 'versions', label: '버전 기록' },
    { key: 'ask', label: 'AI 질문' },
    { key: 'check', label: '팩트체크' },
  ]

  return (
    // max-h: 펼쳐도 본문이 절반 넘게 남아야 "본문을 넓게" 라는 목적이 유지된다.
    // shrink-0 은 접힌 탭 줄이 본문에 눌려 사라지지 않게 하는 것이라 좁은 폭에만 건다.
    <aside className="border-line bg-surface flex min-h-0 w-full flex-col border-t max-lg:max-h-[45%] max-lg:shrink-0 lg:w-80 lg:border-t-0 lg:border-l">
      <div className="border-line flex shrink-0 border-b">
        <div role="tablist" className="flex">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls="doc-side-panel"
              // 접힌 상태에서 어느 탭을 누르든 그 탭으로 펼친다. 펼쳐진 탭을 다시 누르면 접는다.
              // 접기는 탭을 바꾸지 않으므로 onTabChange 를 부르지 않는다. 부르면 그 안의
              // dropPendingPreview 가 돌고 있던 버전 스냅샷 요청을 말없이 버린다.
              onClick={() => {
                if (tab !== key) {
                  onTabChange(key)
                  onOpenChange(true)
                  return
                }
                if (open) onCollapse()
                onOpenChange(!open)
              }}
              // 좁은 폭에서 접혀 있으면 고른 탭이라도 밑줄을 뺀다. 밑줄이 있으면 이미 펼친 것처럼 보여
              // 눌러야 열린다는 걸 모른다. 데스크톱(lg)은 늘 펼쳐져 있어 밑줄을 둔다.
              className={cn(
                '-mb-px cursor-pointer border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                tab !== key
                  ? 'text-muted hover:text-fg border-transparent'
                  : open
                    ? 'border-accent text-fg'
                    : 'text-fg lg:border-accent border-transparent',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 접히는 건 탭이 아니라 패널 전체라 화살표는 탭 줄 끝에 하나만 둔다(접힘 ▾, 펼침 ▴).
            버튼이 탭 오른쪽 빈자리를 다 차지해 어디를 눌러도 접고 편다(바텀시트 손잡이처럼).
            데스크톱은 늘 펼쳐져 있어 숨긴다. 이 버튼은 lg 에서 사라지므로 aria-expanded 가
            데스크톱의 늘 보이는 패널을 "접힘"으로 읽을 일이 없다. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="doc-side-panel"
          aria-label="댓글·버전 기록·AI 질문·팩트체크 패널"
          onClick={() => {
            if (open) onCollapse()
            onOpenChange(!open)
          }}
          className="text-muted hover:text-fg flex min-w-11 flex-1 cursor-pointer items-center justify-end pr-3.5 transition-colors lg:hidden"
        >
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>
      {/* 좁은 폭에서 접히면 패널 자체가 사라진다(hidden). 데스크톱은 늘 펼쳐져 있다. */}
      <div
        id="doc-side-panel"
        role="tabpanel"
        className={cn('min-h-0 flex-1 flex-col lg:flex', open ? 'flex' : 'hidden')}
      >
        {children}
      </div>
    </aside>
  )
}

type SidebarTab = 'comments' | 'versions' | 'ask' | 'check'

/**
 * 손가락으로 쓰는 기기인지.
 *
 * 마우스가 없으면 드래그 손잡이를 띄우지 않는다. 손잡이는 포인터가 지나가는 자리를 따라다니며
 * pointer 이벤트를 다루는데, 터치에서는 본문을 처음 누른 것이 그 손잡이를 띄우는 데 쓰여
 * 커서가 잡히지 않는다. 한 번 더 눌러야 커서가 온다(아이폰 사파리에서 확인).
 * 끌어서 옮기는 동작 자체도 손가락으로는 잡기 어려워, 빼는 쪽이 얻는 게 많다.
 * 05·SCR-08 은 모바일에도 손잡이를 두라고 하지만 그건 커서를 막지 않을 때의 이야기다.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarse(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return coarse
}

/**
 * 손잡이가 붙는 블록을 고르는 규칙. 표의 칸 안 문단에는 붙이지 않는다.
 *
 * 표는 통째로 한 블록으로 다룬다. 칸마다 손잡이가 뜨면 표 안쪽에서 칸의 글을 가리고, 거기서
 * 댓글을 달아도 닻은 어차피 표 전체에 걸린다(`blockId.ts` 가 최상위 블록에 단다).
 * 확장의 기본 규칙은 행과 칸 자체, 머리 칸의 문단만 빼고 본문 칸의 문단은 남긴다. 머리 칸도
 * 여기에 같이 적어 기본 규칙에 기대지 않는다. 빼고 나면 칸 위에서는 표 전체의 손잡이가 뜬다.
 */
const HANDLE_TARGETS: NonNullable<DragHandleProps['nested']> = {
  rules: [
    {
      id: 'tableCellContent',
      evaluate: ({ parent }) =>
        parent && ['tableCell', 'tableHeader'].includes(parent.type.name) ? 1000 : 0,
    },
  ],
}

/**
 * 문단 왼쪽에 뜨는 손잡이. 끌어서 블록을 옮기고, 누르면 그 블록을 통째로 고른다.
 * 옆의 말풍선은 그 블록의 댓글 창을 연다(05 SCR-02, BlockComments).
 */
function BlockDragHandle({
  editor,
  onComment,
}: {
  editor: Editor
  onComment: (pos: number) => void
}) {
  const posRef = useRef(-1)

  return (
    <DragHandle
      editor={editor}
      nested={HANDLE_TARGETS}
      onNodeChange={({ pos }) => {
        posRef.current = pos
      }}
      // 글머리 점·번호는 항목 상자의 왼쪽 바깥(목록의 들여쓰기 칸)에 그려진다. 항목에 그대로 붙이면
      // 손잡이가 그 기호를 덮으므로, 목록 항목일 때는 목록의 왼쪽 끝에 붙인다.
      // 확장이 onNodeChange 를 부른 직후에 이 함수를 부르는 순서에 기댄다(인자가 없어 posRef 로 받는다).
      getReferencedVirtualElement={() => {
        const li = posRef.current >= 0 ? editor.view.nodeDOM(posRef.current) : null
        if (!(li instanceof HTMLLIElement) || !li.parentElement) return null
        const list = li.parentElement
        return {
          getBoundingClientRect: () => {
            const item = li.getBoundingClientRect()
            const left = list.getBoundingClientRect().left
            return new DOMRect(left, item.top, item.right - left, item.height)
          },
        }
      }}
      // h-7: 본문 한 줄 높이(leading-7). 블록 위쪽에 붙는 손잡이가 첫 줄 한가운데에 오게 한다.
      // ponytail: 높이 고정. 줄 높이가 다른 제목 1(32px)·제목 3(24px)은 2px 어긋난다.
      // 거슬리면 onNodeChange 에서 그 블록의 line-height 를 읽어 맞춘다.
      className="flex h-7 items-center pr-1"
    >
      <button
        type="button"
        title="이 블록에 댓글"
        aria-label="이 블록에 댓글"
        className="text-subtle hover:bg-surface-hover hover:text-muted grid size-6 cursor-pointer place-items-center rounded"
        onClick={() => {
          if (posRef.current >= 0) onComment(posRef.current)
        }}
      >
        <MessageSquarePlus className="size-4" />
      </button>
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

/** AI 가 이 문서를 근거로 써도 되는지. 꺼져 있으면 아이콘에 사선을 긋는다. */
function AiSourceToggle({ docId, on }: { docId: string; on: boolean }) {
  const { mutate, isPending } = useSetAiSource(docId)
  const toast = useToast()
  const label = on ? 'AI 근거로 쓰는 중' : 'AI 근거에서 빠짐'
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="AI 근거로 쓰기"
      title={`${label}. 누르면 ${on ? '끕니다' : '켭니다'}`}
      // 요청 중에 disabled 로 잠그면 키보드 초점이 버튼에서 빠진다. 두 번째 누름만 흘린다.
      onClick={() =>
        !isPending &&
        mutate(!on, {
          onSuccess: (doc) =>
            toast.success(
              doc.ai_source
                ? 'AI 가 이 문서를 근거로 씁니다.'
                : 'AI 가 이 문서를 근거로 쓰지 않습니다.',
            ),
          onError: (err) =>
            toast.error(err instanceof ApiError ? err.message : '바꾸지 못했습니다.'),
        })
      }
      className={cn(
        'relative grid size-7 cursor-pointer place-items-center rounded transition-colors',
        on ? 'text-accent' : 'text-subtle hover:text-fg',
      )}
    >
      <Sparkles className="size-4" />
      {!on && <span aria-hidden className="absolute h-px w-5 rotate-45 bg-current" />}
    </button>
  )
}

function DocSurface({ session, meta }: { session: CollabSession; meta: DocDetail }) {
  const user = useCurrentUser()
  const { doc, provider } = session
  const { title, setTitle } = useCollabTitle(doc, meta.title)
  const { width } = useCollabWidth(doc)
  const { mutate: touchDoc } = useTouchDoc(meta.id)
  const { mutate: saveVersion, isPending: savingVersion } = useSaveVersion(meta.id)
  const versionSnapshot = useVersionSnapshot(meta.id)

  const navigate = useNavigate()
  const [confirmTrash, setConfirmTrash] = useState(false)

  const [tab, setTab] = useState<SidebarTab>('comments')
  const [sideOpen, setSideOpen] = useState(false)
  // 멘션 알림(`?comment=`)으로 들어오면 댓글 탭으로 옮기고 좁은 폭에서도 펼친다. 같은 문서를 연 채로
  // 알림을 눌러도 오도록 값이 바뀔 때마다 본다(렌더 중 상태 조정). 파라미터는 CommentPanel 이
  // 댓글을 찾아 밝힌 뒤 걷는다.
  // ponytail: 버전 스냅샷 요청이 도는 중이면 그 응답이 미리보기를 열 수 있다. 드물어서 막지 않는다.
  const [params] = useSearchParams()
  const focusComment = params.get('comment')
  const [seenFocus, setSeenFocus] = useState<string | null>(null)
  if (focusComment !== seenFocus) {
    setSeenFocus(focusComment)
    if (focusComment) {
      setTab('comments')
      setSideOpen(true)
    }
  }
  /** 본문에서 댓글 창이 열린 블록(BlockComments). */
  const [openComment, setOpenComment] = useState<string | null>(null)
  /**
   * 스냅샷 요청의 세대. 늦게 온 응답이 지금 화면을 덮어쓰지 않게 막는다.
   *
   * 미리보기를 여는 일이 요청 한 번을 끼면서 비동기가 됐다. 버전을 누르고 미리보기를 닫거나
   * 댓글 탭으로 옮긴 뒤에 응답이 도착하면, 닫아 둔 미리보기가 다시 열리거나 댓글을 보고 있는데
   * 본문이 과거 버전으로 바뀐다. 화면을 바꾸는 모든 자리에서 세대를 올리고, 응답은 자기 세대가
   * 아직 최신일 때만 반영한다.
   */
  const previewSeq = useRef(0)
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    version: DocVersion
    content: RestoredContent
    /** 바로 앞 버전의 내용. 미리보기가 이것과 견줘 바뀐 곳을 칠한다. */
    before: RestoredContent | null
  } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const editor = useEditor({
    extensions: buildDocExtensions({
      doc,
      provider,
      user: { name: user.name, color: hueToColor(hueOf(user.id)) },
    }),
    editorProps: {
      attributes: { class: 'zenith-editor outline-none' },
    },
    onCreate: ({ editor: created }) => {
      // 서버가 Yjs 초기 상태를 주기 전까지의 임시 경로. 문서를 처음 여는
      // 탭에서만 초안을 심는다.
      if (session.isEmpty && meta.seedHtml) {
        created.commands.setContent(meta.seedHtml)
      }
    },
  })

  const { uploading, error: uploadError, clearError } = useFileUpload(editor, meta.id)

  // 사진을 끌어 옮길 때 화면 끝에 닿으면 본문이 그 방향으로 굴러야 한다.
  const scrollRef = useRef<HTMLDivElement>(null)
  useDragAutoScroll(scrollRef)
  const coarsePointer = useCoarsePointer()

  // 제목의 원천도 Y.Doc이다. 비어 있으면 서버 사본으로 한 번 채운다. 서버가 빈 제목을 받지 않아
  // 새 문서는 UNTITLED_DOC 로 만들어지는데, 그걸 글자로 채우면 치는 제목이 그 뒤에 붙는다.
  // 그 경우만 비워 둬서 입력칸의 안내 문구로 보이게 한다.
  useEffect(() => {
    const metaMap = doc.getMap<string>('meta')
    if (metaMap.get('title') === undefined)
      metaMap.set('title', meta.title === UNTITLED_DOC ? '' : meta.title)
  }, [doc, meta.title])

  // 편집이 멎으면 목록·검색이 볼 사본(제목·수정시각)을 갱신하고 버전을 남긴다.
  // 버전은 서버가 합쳐 준다. 같은 사람이 이어서 편집하는 동안은 하나로 접힌다.
  useEffect(() => {
    let metaTimer: number | undefined
    let versionTimer: number | undefined

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      // 다른 탭·다른 사람에게서 온 변경은 그쪽에서 이미 반영한다.
      // 본문 폭만 바꾼 것은 편집이 아니다(collabState 의 WIDTH_ORIGIN).
      if (origin === provider || origin === WIDTH_ORIGIN) return

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

  /**
   * 미리보기를 열 때 그 버전의 스냅샷을 받아 온다. 목록에는 스냅샷이 없다(`VersionMeta`).
   * 버전이 쌓인 문서에서 목록 한 번이 수십 MB 가 되기 때문이다.
   */
  /** 화면이 바뀌었다. 지금 도는 스냅샷 요청의 결과는 버린다. */
  const dropPendingPreview = () => {
    previewSeq.current += 1
    setPendingVersionId(null)
  }

  const closePreview = () => {
    dropPendingPreview()
    setPreviewError(null)
    setPreview(null)
  }

  const openPreview = (version: DocVersion | null, previous?: DocVersion) => {
    if (!version) return closePreview()

    // 미리보기는 편집기를 통째로 가린다. 댓글 창을 열어 둔 채 다녀오면 빈 창이 되살아나 포커스를 가져간다.
    setOpenComment(null)
    dropPendingPreview()
    const seq = previewSeq.current
    setPreviewError(null)
    setPendingVersionId(version.id)

    // 바로 앞 버전도 같이 받는다. 그쪽이 실패하면 비교 없이 내용만 보여 준다.
    const before = previous
      ? versionSnapshot
          .mutateAsync(previous.id)
          .then((full) => readSnapshot(doc, full.snapshot))
          .catch(() => null)
      : Promise.resolve(null)

    versionSnapshot.mutate(version.id, {
      onSuccess: async (full) => {
        const beforeContent = await before
        if (seq !== previewSeq.current) return
        setPendingVersionId(null)
        try {
          setPreview({
            version,
            content: readSnapshot(doc, full.snapshot),
            before: beforeContent,
          })
        } catch {
          // 이 기능이 붙기 전에 만들어진 문서는 삭제 이력이 이미 수거돼 복원할 수 없다.
          setPreview(null)
          setPreviewError(
            '이 버전은 복원할 수 없습니다. 기록 보존 설정 이전에 만들어진 문서입니다.',
          )
        }
      },
      onError: (err) => {
        if (seq !== previewSeq.current) return
        setPendingVersionId(null)
        setPreview(null)
        setPreviewError(err instanceof ApiError ? err.message : '이 버전을 불러오지 못했습니다.')
      },
    })
  }

  /** 블록의 댓글 창을 여닫는다(BlockComments). */
  const openBlockComment = (blockId: string | null) => {
    // 도는 스냅샷 요청이 뒤늦게 미리보기를 열면 쓰던 창이 본문째 사라진다.
    if (blockId) dropPendingPreview()
    setOpenComment(blockId)
  }

  /** `pos`(없으면 커서)가 든 최상위 블록의 댓글 창을 연다. */
  const startBlockComment = (pos?: number) => {
    const blockId = editor && anchorBlock(editor, pos)
    if (blockId) openBlockComment(blockId)
  }

  /**
   * 댓글의 닻 블록으로 간다. 버전 미리보기가 본문을 가리고 있으면 닫고, 편집기가 다시 붙은 뒤에
   * 찾는다. 좁은 폭에서는 댓글이 본문 아래를 덮지만, 굴리는 것은 본문 쪽이라 블록이 위에 보인다.
   */
  const jumpToBlock = useCallback(
    (blockId: string) => {
      if (!editor) return
      setPreview(null)
      requestAnimationFrame(() => flashBlock(editor, blockId))
    },
    [editor],
  )

  /** 마지막으로 간 팩트체크 발췌와 자리. 같은 주장을 다시 누르면 그 뒤의 자리로 넘어간다. */
  const lastJump = useRef<{ text: string; from: number } | null>(null)
  /**
   * 팩트체크 주장의 원문 발췌로 간다. 같은 글이 여러 번 나오면 누를 때마다 다음 자리로, 끝이면 처음으로.
   * 그 글을 골라 두고 그 블록을 잠깐 밝힌다. 미리보기가 본문을 가리고 있으면 `jumpToBlock` 처럼 닫는다.
   * 터치 기기는 편집기에 초점을 주지 않는다. 화상 키보드가 올라와 본문을 가린다.
   */
  const jumpToText = useCallback(
    (text: string) => {
      if (!editor) return false
      const { doc } = editor.state
      const last = lastJump.current
      const range =
        (last?.text === text && findText(doc, text, last.from + 1)) || findText(doc, text)
      if (!range) return false
      lastJump.current = { text, from: range.from }
      setPreview(null)
      requestAnimationFrame(() => {
        const chain = editor.chain()
        if (!coarsePointer) chain.focus()
        chain.setTextSelection(range).scrollIntoView().run()
        const { node } = editor.view.domAtPos(range.from)
        const el = node instanceof HTMLElement ? node : node.parentElement
        if (el) flashElement(el)
      })
      return true
    },
    [editor, coarsePointer],
  )

  const restore = () => {
    if (!editor || !preview) return
    // 되감기가 아니라 새 편집이다. 그래야 접속 중인 다른 사람과도 같은
    // 결과로 수렴하고, 되돌리기 자체를 Ctrl+Z로 취소할 수 있다.
    editor.commands.setContent(preview.content.json)
    if (preview.content.title !== undefined) {
      doc.getMap<string>('meta').set('title', preview.content.title)
    }
    saveVersion({ snapshot: takeSnapshot(doc), label: '되돌림' })
    closePreview()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 경로와 함께 편집 중인 사람. 청사진 1b의 44px 상단 줄이다. */}
      <div className="border-line bg-surface flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <DocBreadcrumb docId={meta.id} title={title} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <PresenceBar session={session} />
          {/* 좁은 화면에서는 본문이 이미 화면 폭을 다 쓴다. 고를 것이 없어 숨긴다. */}
          <div className="max-md:hidden">
            <DocWidthMenu doc={doc} />
          </div>
          {editor && <ExportMenu editor={editor} title={title || UNTITLED_DOC} />}
          <AiSourceToggle docId={meta.id} on={meta.ai_source} />
          <button
            type="button"
            aria-label="문서를 휴지통으로"
            title="휴지통으로"
            onClick={() => setConfirmTrash(true)}
            className="text-subtle hover:text-danger grid size-7 cursor-pointer place-items-center rounded transition-colors"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {confirmTrash && (
        <TrashDocModal
          id={meta.id}
          title={title || UNTITLED_DOC}
          onClose={() => setConfirmTrash(false)}
          // 휴지통으로 보내면 문서 목록으로 나간다.
          onTrashed={() => void navigate('/docs', { replace: true })}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {preview ? (
          <VersionPreview
            version={preview.version}
            content={preview.content}
            before={preview.before}
            widthClass={width.className}
            onRestore={restore}
            onClose={closePreview}
            restoring={savingVersion}
          />
        ) : (
          // min-w-0: 서식 툴바는 가로로 구르는 한 줄인데, 이게 없으면 툴바 전체 폭이 이 열의 최소 폭이 되어
          // 좁은 데스크톱 폭에서 오른쪽 댓글 패널을 화면 밖으로 민다.
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {editor && (
              <EditorToolbar
                editor={editor}
                uploading={uploading}
                onComment={() => startBlockComment()}
              />
            )}

            {uploadError && (
              <p
                role="alert"
                className="text-danger bg-danger/10 flex items-center gap-2 px-4 py-2 text-xs"
              >
                <span className="flex-1">{uploadError}</span>
                <button
                  type="button"
                  aria-label="알림 닫기"
                  onClick={clearError}
                  className="hover:bg-danger/15 cursor-pointer rounded p-0.5"
                >
                  <X className="size-3.5" />
                </button>
              </p>
            )}

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div ref={tableBleedRef} className={cn('mx-auto px-6 py-8', width.className)}>
                <p className="text-subtle mb-1 text-xs">
                  <Avatar
                    name={meta.updated_by?.name ?? '?'}
                    hue={hueOf(meta.updated_by?.id ?? '')}
                    size="sm"
                    className="mr-1.5 align-middle"
                  />
                  {meta.updated_by?.name ?? '알 수 없음'} · {formatRelative(meta.updated_at)} 수정
                </p>

                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={UNTITLED_DOC}
                  aria-label="문서 제목"
                  className="text-fg placeholder:text-subtle w-full bg-transparent py-2 text-3xl font-bold tracking-tight outline-none"
                />

                {editor ? (
                  <>
                    <EditorBubbleMenu editor={editor} />
                    {/* 둘 다 포인터로 쓰는 것이다. 손가락 기기에서는 서식 툴바의 표 메뉴가 같은 일을 한다. */}
                    {!coarsePointer && (
                      <>
                        <BlockDragHandle editor={editor} onComment={startBlockComment} />
                        <TableRowMenu editor={editor} />
                      </>
                    )}
                    <BlockComments
                      editor={editor}
                      docId={meta.id}
                      openId={openComment}
                      onOpenChange={openBlockComment}
                      rowMenu={!coarsePointer}
                    />
                    <EditorContent editor={editor} className="mt-4" />
                    <InlineAiPopover editor={editor} docId={meta.id} />
                  </>
                ) : (
                  <Spinner className="mt-6" />
                )}
              </div>
            </div>
          </div>
        )}

        <DocSidebar
          tab={tab}
          onTabChange={(next) => {
            // 탭을 옮기면 도는 요청의 결과도 버린다. 댓글을 보는데 본문이 바뀌면 안 된다.
            dropPendingPreview()
            setTab(next)
          }}
          open={sideOpen}
          onOpenChange={setSideOpen}
          onCollapse={closePreview}
        >
          {tab === 'comments' ? (
            <CommentPanel docId={meta.id} editor={editor} onJump={jumpToBlock} />
          ) : tab === 'ask' || tab === 'check' ? null : (
            <>
              {previewError && (
                <p
                  role="alert"
                  className="text-danger bg-danger/10 m-2 rounded-lg px-3 py-2 text-xs"
                >
                  {previewError}
                </p>
              )}
              <VersionPanel
                docId={meta.id}
                selectedId={preview?.version.id ?? pendingVersionId}
                pendingId={pendingVersionId}
                onSelect={openPreview}
              />
            </>
          )}
          {/* 다른 탭을 보는 동안에도 숨긴 채 둔다. 받던 답변의 요청 상태와 쓰던 질문이 탭을 옮겨도 남는다. */}
          <div hidden={tab !== 'ask'} className="flex min-h-0 flex-1 flex-col">
            <DocAskPanel docId={meta.id} aiSource={meta.ai_source} />
          </div>
          <div hidden={tab !== 'check'} className="flex min-h-0 flex-1 flex-col">
            <DocCheckPanel editor={editor} aiSource={meta.ai_source} onJump={jumpToText} />
          </div>
        </DocSidebar>
      </div>
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
