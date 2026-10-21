import { hueOf } from '@/lib/avatar'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import DragHandle, { type DragHandleProps } from '@tiptap/extension-drag-handle-react'
import {
  ChevronDown,
  GripVertical,
  Maximize2,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
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
import { clampPanelHeight, halfHeight, releaseSpeed, sheetStop, touchIntent } from './docPanel'
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
 *
 * 손가락 기기(폰·태블릿)에서는 바텀시트처럼 끈다(노션 모바일). 누르고 있는 동안 패널이 손가락을 따라오고,
 * 놓으면 가까운 단계(접힘·원래 높이·다 펼침)로 간다. 빠르게 튕기면 그 방향의 다음 단계로 간다.
 * 다 펼치기 전에는 패널 어디를 잡아도 끌리고 안쪽은 굴러가지 않는다. 다 펼치면 안쪽이 제 스크롤을 쓰고,
 * 막대·탭 줄을 끌거나 안쪽이 맨 위일 때 아래로 당기면 따라 내려온다.
 *
 * 같은 일을 하는 표시는 기기마다 하나만 둔다. 손가락 기기는 잡는 막대, 마우스 기기(PC 창을 줄인 경우)는
 * 탭 줄 끝의 화살표다. PC 는 사이드바 폭처럼 윗 테두리를 끌어 높이를 고른다(`PanelHeightHandle`).
 */
function DocSidebar({
  tab,
  onTabChange,
  open,
  onOpenChange,
  full,
  onFullChange,
  onCollapse,
  hidden,
  children,
}: {
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  /** 좁은 폭에서 펼쳐져 있는지. 알림으로 들어올 때 바깥에서 펼친다. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 좁은 폭에서 맨 위까지 펼쳤는지. 본문으로 가야 하는 동작(블록·문장으로 가기, 미리보기)은 바깥에서 내린다. */
  full: boolean
  onFullChange: (full: boolean) => void
  /** 좁은 폭에서 접을 때. 본문을 넓게 보려는 것이므로 본문을 가린 미리보기도 같이 닫는다. */
  onCollapse: () => void
  /** 넓은 화면에서 닫아 뒀는지(상단 줄의 패널 버튼). 좁은 폭은 위의 open 이 따로 여닫는다. */
  hidden: boolean
  children: ReactNode
}) {
  const TABS: { key: SidebarTab; label: string }[] = [
    { key: 'comments', label: '댓글' },
    { key: 'versions', label: '버전 기록' },
    { key: 'ask', label: 'AI 질문' },
    { key: 'check', label: '팩트체크' },
  ]
  const height = usePanelHeight()
  const asideRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const [headHeight, setHeadHeight] = useState(0)
  /** 패널이 든 칸의 높이. 원래 높이(45%)를 px 로 알아야 여닫는 동안 안쪽을 그 크기로 붙들어 둔다. */
  const [boxHeight, setBoxHeight] = useState(0)
  /** 손가락으로 끄는 동안의 패널 높이(px). 끄지 않을 때는 null 이고 단계 클래스가 높이를 정한다. */
  const [dragHeight, setDragHeight] = useState<number | null>(null)

  // 접힌 높이(막대 + 탭 줄)와 칸 높이를 잰다. 첫 그림 전에 재야 접힌 패널이 한순간 내용 높이로 커지지 않는다.
  // 글꼴이 늦게 붙거나 기기 종류가 바뀌면(막대가 생기고 사라짐), 창 높이가 바뀌면 다시 잰다.
  useLayoutEffect(() => {
    const head = headRef.current
    const box = asideRef.current?.parentElement
    if (!head || !box) return
    const measure = () => {
      // 넓은 화면에서 닫아 둔 동안(display:none)은 0 으로 잰다. 그 값을 쓰면 좁은 폭으로 돌아올 때 한 프레임 튄다.
      const height = head.getBoundingClientRect().height
      if (height) setHeadHeight(height)
      setBoxHeight(box.clientHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(head)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  /** 방금 끌기로 끝났는지. 놓은 자리의 버튼에 뒤따르는 click 을 삼킨다(aside 의 onClickCapture). */
  const justDragged = useRef(false)

  /**
   * 손가락 끌기를 시작한다(y0 은 누른 자리). move 로 높이를 손가락에 붙이고, end 로 놓은 높이와 속도에 맞는
   * 단계로 보낸다. TAP_SLOP 안에서 놓으면 누른 것이라 아무것도 안 하고 end 가 false 다.
   */
  const startDrag = (y0: number) => {
    const aside = asideRef.current
    const total = aside?.parentElement?.clientHeight
    if (!aside || !total) return null
    const h0 = aside.getBoundingClientRect().height
    const closed = headHeight + 1
    const stops = { closed, half: halfHeight(total, headHeight), full: total }
    let h = h0
    let following = false
    /** 손가락 자리. 놓을 때 속도를 잰다(`releaseSpeed`). */
    let samples: { y: number; t: number }[] = []
    return {
      move(y: number) {
        if (!following && Math.abs(y - y0) <= TAP_SLOP) return
        following = true
        const t = performance.now()
        samples = [...samples.filter((s) => t - s.t < 200), { y, t }]
        h = Math.min(Math.max(h0 + y0 - y, stops.closed), stops.full)
        setDragHeight(h)
      },
      /** cancel: 시스템이 손짓을 가져갔다(홈 막대 쓸기 등). 그때 속도는 사용자 뜻이 아니라 가장 가까운 단계로. */
      end(cancel = false) {
        if (!following) return false
        const v = cancel ? 0 : releaseSpeed(samples, performance.now())
        const stop = sheetStop(h, v, stops, h0)
        setDragHeight(null)
        if (stop === 'closed') {
          if (open) onCollapse()
          onOpenChange(false)
        } else {
          onOpenChange(true)
          onFullChange(stop === 'full')
        }
        return true
      },
    }
  }

  // 아래 터치 처리는 한 번만 달고, 지금 상태는 이것들로 읽는다. 다 펼침에서 내려오는 순간 처리를 걷으면
  // 아직 남은 손짓이 막히지 않고 안쪽을 굴리거나 바깥(화면 전체)으로 넘어간다.
  const isFull = useEffectEvent(() => full)
  const beginTouchDrag = useEffectEvent((y: number) => startDrag(y))

  // 다 펼친 동안 안쪽은 제 스크롤을 쓴다. 안쪽이 맨 위일 때 아래로 당기면 노션처럼 패널이 따라 내려오고,
  // 굴러갈 데가 없는 쪽으로 밀면 막는다(놔두면 화면 전체가 튕긴다, `touchIntent`).
  // 브라우저 스크롤을 막아야 해서 passive 가 아닌 touchmove 를 직접 단다(React 의 onTouchMove 는 못 막는다).
  // 다 펼치기 전에는 아래 touch-none 이 스크롤을 막고, 끌기는 포인터 이벤트(swipe)가 맡는다.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let id = -1
    let startX = 0
    let startY = 0
    let scroller: Element | null = null
    let mode: 'idle' | 'wait' | ReturnType<typeof touchIntent> = 'idle'
    let drag: ReturnType<typeof startDrag> = null
    const same = (list: TouchList) => [...list].find((t) => t.identifier === id)

    const onStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        // 두 번째 손가락(머리를 끄는 중에 안쪽을 만진 것 포함). 아직 정하기 전이면 브라우저(확대 등)에 넘긴다.
        if (mode === 'wait') mode = 'scroll'
        return
      }
      // 손가락 하나로 새로 닿았다. 지난 손짓의 끝 신호를 놓쳤어도 여기서 새로 시작한다. 처음 닿은 요소가
      // 손짓 도중 DOM 에서 빠지면(받는 중인 AI 답 위에서 끌기) 끝 신호가 여기까지 안 온다. 끌던 것은
      // 가까운 단계로 마무리한다. 안 하면 끄는 높이가 남아 패널이 그 높이로 굳는다.
      drag?.end(true)
      drag = null
      mode = 'idle'
      if (!isFull()) return
      const touch = e.changedTouches[0]
      id = touch.identifier
      startX = touch.clientX
      startY = touch.clientY
      scroller = scrollParent(e.target, el)
      mode = 'wait'
    }
    const onMove = (e: TouchEvent) => {
      const touch = same(e.touches)
      if (!touch || mode === 'idle' || mode === 'scroll') return
      if (mode === 'wait') {
        const dx = touch.clientX - startX
        const dy = touch.clientY - startY
        // 몇 px 모은 뒤에 정한다. 대는 순간의 1~2px 흔들림을 방향으로 읽으면 스크롤이 통째로 먹힌다.
        // 브라우저가 굴리기 시작하는 거리(약 8~10px)보다 작아야 그 전에 막을 수 있다.
        if (Math.hypot(dx, dy) < INTENT_SLOP) return
        mode = touchIntent(dx, dy, scroller)
        if (mode === 'scroll') return
        if (mode === 'sheet') drag = beginTouchDrag(startY)
      }
      // 시트로 정한 손짓은 패널이 내려온 뒤에도 손을 뗄 때까지 막는다.
      e.preventDefault()
      drag?.move(touch.clientY)
    }
    const onEnd = (e: TouchEvent) => {
      if (mode === 'idle' || !same(e.changedTouches)) return
      // 10~15px 짧게 끌면 브라우저가 탭으로 쳐 click 이 올 수 있다. 끌었으면 삼킨다(포인터 경로와 같다).
      if (drag?.end(e.type === 'touchcancel')) justDragged.current = true
      drag = null
      mode = 'idle'
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  const swipe = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return
    // 데스크톱(lg)은 본문 오른쪽에 서 있어 끌 것이 없다. PC 는 테두리 손잡이로 높이를 고른다.
    if (window.matchMedia('(min-width: 64rem), (pointer: fine)').matches) return
    // 트랙패드·마우스·펜으로 안쪽 글자를 고르는 끌기는 시트 끌기가 아니다. 머리(막대·탭 줄)는 무엇으로든 끈다.
    if (event.pointerType !== 'touch' && !headRef.current?.contains(event.target as Node)) return
    const drag = startDrag(event.clientY)
    if (!drag) return
    // 처음 누른 손가락만 본다.
    const id = event.pointerId

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== id) return
      // 놓는 신호를 놓쳤으면(창 밖에서 놓음) 버튼이 풀린 채 움직인다. 거기서 끝낸다.
      if (!(move.buttons & 1)) return onUp(move)
      drag.move(move.clientY)
    }
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== id) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // 끌다 놓은 자리가 버튼이면 click 이 뒤따를 수 있다. 누른 게 아니라 끈 것이라 삼킨다.
      // 시간이 아니라 표시로 한다. 아이폰은 탭의 click 을 손 뗀 뒤 따로 보내 늦게 올 수 있다.
      if (drag.end(up.type === 'pointercancel')) justDragged.current = true
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <>
      {open && <PanelHeightHandle panel={height} />}
      {/* 펼친 높이는 내용과 상관없이 본문 칸에 대한 비율이다(내용만큼이면 댓글이 적을 때 낮게 열린다).
          본문이 남아야 "본문을 넓게" 라는 목적이 유지된다. 손가락 기기(폰)는 세로가 짧아 45%, 마우스 기기
          (PC 창을 줄인 경우)는 끌어 고른 높이(처음 60%, 220px 이상, 본문 120px 이상 남김). 다 펼치면 칸을 꽉 채운다.
          높이가 바뀔 때마다(열기·닫기·다 펼침·내려오기) 움직인다. 접힌 높이가 auto 면 % 와 섞여 움직이지
          않아서 머리 높이를 재서 숫자로 둔다. 손가락으로 끄는 동안은 높이를 손가락에 붙이고 전환을 끈다.
          놓으면 단계 클래스로 돌아가며 그 자리에서부터 움직인다. PC 손잡이를 끄는 동안은 index.css 가 끈다.
          접혀 있을 때만 안쪽을 자른다. 펼친 동안 자르면 댓글 입력칸 위로 뜨는 멘션 목록이 잘린다. clip 이라
          접힌 안쪽에서 부르는 scrollIntoView 가 패널을 굴려 탭 줄을 밀어내지도 못한다.
          끄는 자리: 다 펼치기 전에는 패널 전체다. touch-action 은 손가락이 닿은 곳에서 가장 가까운 스크롤 칸까지만
          따지므로 안쪽 요소 전부(목록·입력칸)에 건다. aside 에만 걸면 안쪽 목록이 그대로 굴러간다.
          둥근 윗모서리는 바텀시트 모양이라 손가락 기기만. PC 는 사이드바처럼 곧은 테두리에 손잡이가 뜬다.
          shrink-0 은 접힌 탭 줄이 본문에 눌려 사라지지 않게 하는 것이라 좁은 폭에만 건다. */}
      <aside
        ref={asideRef}
        onPointerDownCapture={() => (justDragged.current = false)}
        onClickCapture={(e) => {
          // 키보드·화면 낭독기가 만든 click(detail 0)은 끌기의 뒤끝이 아니다. 먹으면 버튼이 한 번 안 눌린다.
          if (!justDragged.current || e.detail === 0) return
          justDragged.current = false
          e.stopPropagation()
          e.preventDefault()
        }}
        onPointerDown={full ? undefined : swipe}
        style={
          {
            '--doc-panel-h': `${height.value}%`,
            // 위 테두리 1px 까지(border-box). 재기 전에는 비워 둬서 auto 로 그린다.
            '--doc-panel-head': headHeight ? `${headHeight + 1}px` : undefined,
            // 원래 높이의 안쪽 높이(위 테두리를 뺀다). 아래 안쪽 묶음이 이보다 작아지지 않는다.
            '--doc-panel-half': boxHeight
              ? `${halfHeight(boxHeight, headHeight) - 1}px`
              : undefined,
            ...(dragHeight !== null && { height: dragHeight, transition: 'none' }),
          } as CSSProperties
        }
        // 화면을 나눴을 때 왼쪽 칸이 이걸 보고 두 본문 폭을 다시 맞춘다(DocEditorPage).
        data-panel-hidden={hidden || undefined}
        className={cn(
          'border-line bg-surface flex min-h-0 w-full flex-col border-t max-lg:shrink-0 max-lg:pointer-coarse:rounded-t-xl lg:w-80 lg:border-t-0 lg:border-l',
          hidden && 'lg:hidden',
          'motion-safe:max-lg:transition-[height] motion-safe:max-lg:duration-500 motion-safe:max-lg:ease-[cubic-bezier(0.32,0.72,0,1)]',
          !full && 'max-lg:pointer-coarse:touch-none max-lg:pointer-coarse:[&_*]:touch-none',
          !open
            ? 'max-lg:h-(--doc-panel-head) max-lg:overflow-clip'
            : full
              ? 'max-lg:h-full'
              : // 원래 높이: 45% 와 263px 중 큰 쪽, 본문은 120px 남김(`halfHeight` 와 맞춘다).
                'max-lg:h-[45%] max-lg:pointer-coarse:min-h-[min(263px,calc(100%_-_120px))]',
          // PC 는 다 펼침이 없다. 손가락 기기에서 다 펼친 채 마우스 기기로 바뀌어도(태블릿 모드 해제) PC 높이로.
          // 범위(최소 220px, 본문 120px 남김)는 창을 줄여도, 옛 저장값이어도 지킨다.
          open &&
            'max-lg:pointer-fine:h-(--doc-panel-h) max-lg:pointer-fine:max-h-[calc(100%_-_7.5rem)] max-lg:pointer-fine:min-h-[min(13.75rem,100%)]',
        )}
      >
        {/* 안쪽 묶음(머리 + 탭 패널). 손가락 기기에서는 원래 높이보다 작아지지 않고 윗변에 붙는다.
            그래서 원래 높이 아래로 여닫거나 끄는 동안에는 입력칸까지 통째로 미끄러지고, 아래로 넘친 부분은
            잘린다(접힘이면 aside 의 clip, 열리는 중이면 문서 화면 바깥 칸의 clip). 서랍처럼 윗변만 움직이고
            입력칸이 바닥에 남아 보이지 않게. 원래 높이 위(다 펼침까지)에서는 패널을 따라 늘어나고, 멈춰 있을
            때는 패널과 크기가 같아 입력칸이 늘 맨 아래에 있다. PC 는 패널을 그대로 채운다. */}
        <div className="flex min-h-0 flex-1 flex-col max-lg:pointer-coarse:h-[max(100%,var(--doc-panel-half))] max-lg:pointer-coarse:flex-none">
          <div
            ref={headRef}
            onPointerDown={full ? swipe : undefined}
            className="shrink-0 max-lg:touch-none max-lg:select-none"
          >
            {/* 잡는 막대. 누르면 다 펼침과 원래 높이를 오간다. 끌기가 어려운 사람·화면 낭독기·키보드도
              다 펼칠 수 있게. 끌다 놓았을 때 따라오는 click 은 swipe 의 삼키기가 막는다.
              막대 줄이 12px 라 바로 아래 탭을 잘못 누르기 쉽다. 누르는 자리만 위로 8px 넓힌다(before). */}
            <button
              type="button"
              aria-label={open && full ? '패널 원래 높이로' : '패널 크게 보기'}
              onClick={() => {
                onOpenChange(true)
                onFullChange(!(open && full))
              }}
              className="relative hidden w-full cursor-pointer justify-center pt-2 before:absolute before:inset-x-0 before:-top-2 before:bottom-0 max-lg:pointer-coarse:flex"
            >
              <span className="bg-line-strong h-1 w-9 rounded-full" />
            </button>
            <div className="border-line flex border-b">
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
            데스크톱의 늘 보이는 패널을 "접힘"으로 읽을 일이 없다.
            손가락 기기는 잡는 막대가 이 자리를 대신해 화면에서만 숨긴다(sr-only). 펼침 상태를 알리는
            곳이 여기뿐이라 화면 낭독기에는 남긴다. */}
              <button
                type="button"
                aria-expanded={open}
                aria-controls="doc-side-panel"
                aria-label="댓글·버전 기록·AI 질문·팩트체크 패널"
                onClick={() => {
                  if (open) onCollapse()
                  onOpenChange(!open)
                }}
                className="text-muted hover:text-fg flex min-w-11 flex-1 cursor-pointer items-center justify-end pr-3.5 transition-colors pointer-coarse:sr-only lg:hidden"
              >
                <ChevronDown
                  className={cn('size-4 transition-transform', open && 'rotate-180')}
                  aria-hidden
                />
              </button>
            </div>
          </div>
          {/* 좁은 폭에서 접히면 안쪽을 숨긴다. 바로 지우지 않고 패널이 다 접힌 뒤에 숨겨서(visibility 전환)
            접히는 동안에도 안쪽이 보인다. 숨긴 뒤에는 화면 낭독기·키보드도 닿지 않는다. 데스크톱은 늘 보인다.
            접힌 채로 끌어 올리는 동안에는 따라 올라오는 안쪽이 보여야 한다. */}
          <div
            ref={panelRef}
            id="doc-side-panel"
            role="tabpanel"
            className={cn(
              'flex min-h-0 flex-1 flex-col motion-safe:max-lg:transition-[visibility] motion-safe:max-lg:duration-500',
              // 세로 목록이 끝에 닿아도 남은 손짓을 바깥(화면 전체)으로 넘기지 않는다. 목록에만 건다. 답 속 넓은
              // 표의 가로 스크롤 칸에도 걸면 표 위에서 시작한 세로 손짓이 바깥 대화 목록으로 이어지지 않는다.
              '[&_.overflow-y-auto]:overscroll-y-contain',
              !open && dragHeight === null && 'max-lg:invisible',
            )}
          >
            {children}
          </div>
        </div>
      </aside>
    </>
  )
}

type SidebarTab = 'comments' | 'versions' | 'ask' | 'check'

/**
 * 이보다 덜 움직였으면 끈 게 아니라 누른 것이다(탭 바꾸기·접기가 그대로 돈다). 손가락 탭은 10px 안팎 흔들려도
 * 브라우저가 탭으로 쳐 준다. 그보다 작게 잡으면 흔들린 탭의 click 을 삼켜 버튼이 가끔 먹통이 된다.
 */
const TAP_SLOP = 10
/** 다 펼친 상태의 터치에서 손짓 종류(스크롤·시트·막기)를 정하기 전에 모으는 거리(px). */
const INTENT_SLOP = 4

/** target 에서 root 까지 올라가며 실제로 세로로 굴러가는 칸을 찾는다(댓글 목록, 입력칸 등). 없으면 null. */
function scrollParent(target: EventTarget | null, root: Element) {
  for (
    let node = target instanceof Element ? target : null;
    node && root.contains(node);
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node
  }
  return null
}

/**
 * 패널 높이가 움직이는 중이면 멈춘 뒤에, 아니면 다음 프레임에 fn 을 돌린다. 본문 칸 크기가 변하는 중에
 * 스크롤 자리를 재면(블록·문장으로 가기) 목표가 화면 밖이나 패널 밑에 놓인다. 다음 프레임에 재야 방금
 * 시작한 전환(알림으로 들어와 패널이 열리는 중 등)도 잡힌다.
 */
function afterPanelSettles(fn: () => void) {
  // 움직임이 도중에 다른 움직임으로 바뀌면 앞의 것은 끝나지 않고 취소된다. 끝날 때마다 다시 본다.
  const check = () => {
    const running = document.getElementById('doc-side-panel')?.closest('aside')?.getAnimations()
    if (!running?.length) return fn()
    void Promise.allSettled(running.map((a) => a.finished)).then(check)
  }
  requestAnimationFrame(check)
}

/** 패널 안에 초점이 있으면 푼다. 패널을 접거나 닫을 때. */
function blurPanel() {
  const active = document.activeElement
  if (active instanceof HTMLElement && document.getElementById('doc-side-panel')?.contains(active))
    active.blur()
}

const HIDDEN_KEY = 'zenith.docPanelHidden'

/** 넓은 화면에서 패널을 닫아 뒀는지. 앱 사이드바 접기처럼 이 브라우저에 남겨 다른 문서에서도 따른다. */
function usePanelHidden(persist: boolean) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!persist) return
    try {
      if (hidden) localStorage.setItem(HIDDEN_KEY, '1')
      else localStorage.removeItem(HIDDEN_KEY)
    } catch {
      // 저장소를 못 열면 이 화면에서만 따른다.
    }
  }, [hidden, persist])
  return [hidden, setHidden] as const
}

const HEIGHT_KEY = 'zenith.docPanelHeight'
/** PC 에서 펼친 처음 높이(본문 칸에 대한 %). 폰(45%)보다 세로 여유가 있다. */
const HEIGHT_DEFAULT = 60
const HEIGHT_STEP_PX = 16

function readPanelHeight() {
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY))
    return saved > 0 && saved <= 100 ? saved : HEIGHT_DEFAULT
  } catch {
    return HEIGHT_DEFAULT
  }
}

/**
 * PC 좁은 폭에서 끌어 고른 패널 높이(본문 칸에 대한 %). 사이드바 폭처럼 이 브라우저에만 남긴다.
 * % 라 창 높이가 바뀌어도 본문과 나누는 비율이 그대로다. 창을 줄였을 때의 최소·최대는 CSS 가 같이 지킨다.
 */
function usePanelHeight() {
  const [value, setValue] = useState(readPanelHeight)
  /** total: 지금 칸 높이(px). 최소·최대를 px 로 지키는 데 쓴다. */
  const set = (pct: number, total: number) => {
    const next = clampPanelHeight(pct, total)
    setValue(next)
    try {
      localStorage.setItem(HEIGHT_KEY, String(next))
    } catch {
      // 저장 못 해도 이번 세션의 높이는 유지된다.
    }
  }
  // 기본값을 저장해 두지 않는다. 나중에 기본 높이를 바꾸면 그대로 따라가게.
  const reset = () => {
    setValue(HEIGHT_DEFAULT)
    try {
      localStorage.removeItem(HEIGHT_KEY)
    } catch {
      // 저장소를 못 열면 지울 것도 없다.
    }
  }
  return { value, set, reset }
}

/**
 * PC(마우스) 좁은 폭에서 패널 윗 테두리를 끌어 높이를 바꾸는 손잡이. 사이드바 폭 손잡이(ResizeHandle)와
 * 같은 손맛이다: 끌기, 위·아래 화살표, 두 번 누르면 처음 높이. ResizeHandle 은 px 폭이라 따로 둔다.
 * 패널 바로 위 형제로 두고 음수 여백으로 패널 위쪽 8px(탭 줄의 위 여백)에 겹친다. 위쪽 본문 칸으로 내밀면
 * 본문 스크롤바의 아래 끝을 덮는다.
 */
function PanelHeightHandle({ panel }: { panel: ReturnType<typeof usePanelHeight> }) {
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // 끄는 동안 커서를 유지하고 글자 선택과 전환 애니메이션을 끈다(index.css 의 data-resizing).
    // 끈 다음에 잰다. 두 번 눌러 되돌린 직후처럼 높이가 움직이는 중이면 중간값에서 시작해 튄다.
    const root = document.documentElement
    root.dataset.resizing = 'row'
    const box = event.currentTarget.nextElementSibling
    const total = box?.parentElement?.clientHeight
    if (!box || !total) {
      delete root.dataset.resizing
      return
    }
    event.preventDefault()
    const now = box.getBoundingClientRect().height
    const startY = event.clientY

    const onMove = (move: PointerEvent) => {
      // 창 밖에서 버튼을 놓으면 pointerup 이 안 올 수 있다. 버튼이 풀린 채 움직이면 끝낸다.
      if (!(move.buttons & 1)) return onUp()
      panel.set(((now + startY - move.clientY) / total) * 100, total)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      delete root.dataset.resizing
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const pct = Math.round(panel.value)
  return (
    <div
      role="separator"
      // 위아래로 나뉘면 경계선은 가로로 눕는다.
      aria-orientation="horizontal"
      aria-label="댓글·버전 기록·AI 질문·팩트체크 패널 높이"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`본문 칸의 ${pct}%`}
      tabIndex={0}
      title="끌어서 높이 조절, 두 번 누르면 원래대로"
      onPointerDown={start}
      onDoubleClick={panel.reset}
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowUp' ? HEIGHT_STEP_PX : event.key === 'ArrowDown' ? -HEIGHT_STEP_PX : 0
        const total = step !== 0 && event.currentTarget.parentElement?.clientHeight
        if (!total) return
        event.preventDefault()
        // 움직이는 중의 높이가 아니라 저장한 값에 더한다. 빠르게 누르면 중간값을 재서 들쭉날쭉해진다.
        panel.set(panel.value + (step / total) * 100, total)
      }}
      className="group relative z-10 -mb-2 hidden h-2 shrink-0 cursor-row-resize touch-none outline-none max-lg:pointer-fine:block"
    >
      <span className="group-hover:bg-accent/60 group-focus-visible:bg-accent absolute inset-x-0 top-0 h-0.5 -translate-y-1/2 transition-colors" />
    </div>
  )
}

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

/**
 * 화면을 나눠 오른쪽에 연 문서의 버튼 둘. 크게 열면 그 문서만 남고(옆 패널도 돌아온다), 닫으면 왼쪽만 남는다.
 * 문서를 못 불러온 자리(권한 없음·없음·휴지통)에서도 닫을 수 있게 따로 꺼내 둔다.
 */
export function SplitActions({ docId, onClose }: { docId: string; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <>
      <button
        type="button"
        aria-label="이 문서만 크게 열기"
        title="크게 열기"
        onClick={() => void navigate(`/docs/${docId}`)}
        className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded transition-colors"
      >
        <Maximize2 className="size-4" />
      </button>
      <button
        type="button"
        aria-label="오른쪽 문서 닫기"
        title="닫기"
        onClick={onClose}
        className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded transition-colors"
      >
        <X className="size-4" />
      </button>
    </>
  )
}

function DocSurface({
  session,
  meta,
  onCloseSplit,
}: {
  session: CollabSession
  meta: DocDetail
  /** `replace`: 방문 기록을 남기지 않고 닫는다(휴지통으로 보낸 문서가 뒤로 가기로 되살아나지 않게). */
  onCloseSplit?: (replace?: boolean) => void
}) {
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
  /** 좁은 폭에서 패널을 맨 위까지 펼쳤는지. 그동안 본문은 안 보인다. */
  const [sideFull, setSideFull] = useState(false)
  // 오른쪽에 연 문서는 패널이 없다. 처음 읽은 값을 다시 써서 왼쪽이 바꾼 저장값을 덮지 않게 저장을 끈다.
  const [panelHidden, setPanelHidden] = usePanelHidden(!onCloseSplit)
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
      // 넓은 화면에서 닫아 뒀어도 연다. 오른쪽에 연 문서는 패널이 없어 저장된 값만 바꾸게 되니 건드리지 않는다.
      if (!onCloseSplit) setPanelHidden(false)
      // 다 펼친 높이에서 그 댓글로 굴린 뒤 블록으로 가며 내려오면 굴려 둔 줄이 잘린다. 먼저 내린다.
      setSideFull(false)
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
    // 미리보기는 본문 자리에 뜬다. 패널이 맨 위까지 덮고 있으면 원래 높이로 내린다.
    setSideFull(false)
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
   * 좁은 폭의 패널을 맨 위까지 펼치거나 내린다. 본문이 가려지는데 초점이 남으면 화상 키보드가 그대로고,
   * 친 글이 안 보이는 본문에 들어가서 펼칠 때 초점을 푼다.
   */
  const changeSideFull = (next: boolean) => {
    if (next) editor?.commands.blur()
    setSideFull(next)
  }

  /**
   * 댓글의 닻 블록으로 간다. 버전 미리보기가 본문을 가리고 있으면 닫고, 편집기가 다시 붙은 뒤에
   * 찾는다. 좁은 폭에서는 댓글이 본문 아래를 덮지만, 굴리는 것은 본문 쪽이라 블록이 위에 보인다.
   * 패널이 맨 위까지 덮고 있으면 원래 높이로 내려 본문을 드러내고, 패널이 멈춘 뒤에 찾는다
   * (`afterPanelSettles`, `jumpToText` 도 같다).
   */
  const jumpToBlock = useCallback(
    (blockId: string) => {
      if (!editor) return
      setPreview(null)
      setSideFull(false)
      afterPanelSettles(() => flashBlock(editor, blockId))
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
      setSideFull(false)
      afterPanelSettles(() => {
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
          {/* 넓은 화면에서만. 좁은 폭은 패널의 탭 줄이 여닫는다(같은 일을 하는 버튼을 둘 두지 않는다).
              오른쪽에 연 문서는 패널이 없다. 닫으면 본문을 넓게 보려는 것이라 버전 미리보기도 같이 닫는다. */}
          {!onCloseSplit && (
            <button
              type="button"
              aria-label="댓글·버전 기록·AI 질문·팩트체크 패널"
              aria-expanded={!panelHidden}
              aria-controls="doc-side-panel"
              title={panelHidden ? '패널 열기' : '패널 닫기'}
              onClick={() => {
                if (!panelHidden) {
                  closePreview()
                  // 마우스로 누른 버튼이 초점을 안 받는 브라우저(사파리 등)는 숨긴 입력칸에 초점이 남는다.
                  blurPanel()
                }
                setPanelHidden(!panelHidden)
              }}
              className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded transition-colors max-lg:hidden"
            >
              {panelHidden ? (
                <PanelRightOpen className="size-4" />
              ) : (
                <PanelRightClose className="size-4" />
              )}
            </button>
          )}
          {onCloseSplit && <SplitActions docId={meta.id} onClose={() => onCloseSplit()} />}
        </div>
      </div>

      {confirmTrash && (
        <TrashDocModal
          id={meta.id}
          title={title || UNTITLED_DOC}
          onClose={() => setConfirmTrash(false)}
          // 휴지통으로 보내면 문서 목록으로 나간다. 오른쪽에 연 문서는 그 자리만 닫는다.
          onTrashed={() =>
            onCloseSplit ? onCloseSplit(true) : void navigate('/docs', { replace: true })
          }
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
          // overflow-hidden: 좁은 폭에서 패널을 맨 위까지 펼치면 이 열의 높이가 0 이 된다. 서식 툴바(z-20)가
          // 밖으로 삐져 패널 위에 그려지지 않게 자른다. 툴바 메뉴는 body 로 띄우고, 본문은 안쪽 스크롤 칸이
          // 이미 자르므로 여기서 더 잘리는 것은 없다.
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                    <InlineAiPopover editor={editor} docId={meta.id} onJump={jumpToText} />
                  </>
                ) : (
                  <Spinner className="mt-6" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* 오른쪽에 연 문서는 본문만. 패널까지 두 벌이면 양쪽 본문이 너무 좁다(사용자 결정). */}
        {!onCloseSplit && (
          <DocSidebar
            tab={tab}
            onTabChange={(next) => {
              // 탭을 옮기면 도는 요청의 결과도 버린다. 댓글을 보는데 본문이 바뀌면 안 된다.
              dropPendingPreview()
              setTab(next)
            }}
            open={sideOpen}
            onOpenChange={(next) => {
              setSideOpen(next)
              if (next) return
              // 접었다 다시 펼치면 원래 높이부터.
              setSideFull(false)
              // 접힌 패널 안에 초점이 남으면 화상 키보드가 그대로고, 친 글이 안 보이는 입력칸에 들어간다.
              blurPanel()
            }}
            full={sideFull}
            onFullChange={changeSideFull}
            onCollapse={closePreview}
            hidden={panelHidden}
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
              <DocCheckPanel docId={meta.id} editor={editor} onJump={jumpToText} />
            </div>
          </DocSidebar>
        )}
      </div>
    </div>
  )
}

/** `onCloseSplit` 이 있으면 화면을 나눠 오른쪽에 연 문서다. */
export function DocWorkspace({
  meta,
  onCloseSplit,
}: {
  meta: DocDetail
  /** `replace`: 방문 기록을 남기지 않고 닫는다(휴지통으로 보낸 문서가 뒤로 가기로 되살아나지 않게). */
  onCloseSplit?: (replace?: boolean) => void
}) {
  const session = useCollabSession(meta.id)

  if (!session) {
    return (
      <>
        {/* 세션이 붙기 전에도(브라우저 사본 열기가 막히는 경우 등) 오른쪽 문서는 닫을 수 있어야 한다. */}
        {onCloseSplit && (
          <div className="border-line bg-surface flex h-11 shrink-0 items-center justify-end gap-1 border-b px-4">
            <SplitActions docId={meta.id} onClose={() => onCloseSplit()} />
          </div>
        )}
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-6" />
        </div>
      </>
    )
  }

  return <DocSurface session={session} meta={meta} onCloseSplit={onCloseSplit} />
}
