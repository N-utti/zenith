import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AtSign,
  CornerDownLeft,
  FileText,
  Hash,
  Lock,
  MessagesSquare,
  Megaphone,
  Search,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { ALL_NAV, visibleNav } from '@/app/navigation'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useChannels } from '@/features/chat/api'
import { useSearch } from '@/features/search/api'
import { hitRows, matchRooms, paletteRows, roomRows } from '@/features/search/rows'
import { parseSnippet } from '@/features/search/snippet'
import { SEARCH_TYPE_LABEL, type SearchHit } from '@/features/search/types'
import type { AskState } from '@/features/ai/types'
import { releaseSpeed, touchIntent } from '@/features/docs/docPanel'

/** 글자를 칠 때마다 서버를 부르지 않는다. 멈춘 뒤에 한 번. */
const TYPING_PAUSE_MS = 200

/** 폰 시트를 이만큼 넘게 내렸다 놓으면 닫는다. 덜 내렸으면 빠르게 튕겼을 때만. */
const SWIPE_CLOSE_PX = 120
const SNAP_BACK = 'transform 200ms ease-out'

const HIT_ICONS = { doc: FileText, chat: MessagesSquare, post: Megaphone }

/**
 * 서버가 준 스니펫을 글자로 그린다. `**` 마커만 강조로 바꾼다.
 * 문자열을 HTML 로 넣지 않는다. 본문에 든 태그 조각이 그대로 살아나면 안 된다.
 */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {parseSnippet(text).map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            className="text-fg bg-transparent font-semibold underline decoration-dotted"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

function HitRow({ hit, active }: { hit: SearchHit; active: boolean }) {
  // 모르는 종류가 와도 줄은 그려진다. 아이콘 하나 때문에 목록이 통째로 죽으면 안 된다.
  const Icon = HIT_ICONS[hit.type] ?? FileText
  return (
    <>
      <Icon className="mt-0.5 size-4.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className={cn('truncate', active ? 'font-medium' : 'text-fg')}>{hit.title}</span>
          <span className="text-subtle shrink-0 text-[11px]">
            {SEARCH_TYPE_LABEL[hit.type]} · {hit.sub}
          </span>
        </span>
        {hit.snippet && (
          <span className="text-muted mt-0.5 line-clamp-1 block text-[12px]">
            <Snippet text={hit.snippet} />
          </span>
        )}
      </span>
      <span className="text-subtle shrink-0 text-[11px]">{formatRelative(hit.at)}</span>
    </>
  )
}

/**
 * ⌘K 통합검색. 화면 이동·채팅방 이름·본문 검색(`GET /search`)을 한 목록에 놓는다.
 * 채팅방은 사이드바가 받아 둔 방 목록에서 이름으로 고른다. 서버를 따로 부르지 않고 타자 즉시 걸린다.
 *
 * 열릴 때마다 부모가 새로 마운트하므로 초기화용 effect가 필요 없다.
 *
 * 맨 아래 "AI에게 물어보기"(05 SCR-00)는 검색어를 그대로 /ai 컴포저에 채운다. 화면 목록이 비어도
 * 이 행은 남아 Enter 가 항상 어딘가로 간다.
 *
 * 권한 밖 문서·채팅·게시글은 서버가 결과에서 빼고 내려준다. 여기서 거르지 않는다.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { role } = useCurrentUser()
  const [query, setQuery] = useState('')
  // 화면에 보이는 값과 서버에 보내는 값을 나눈다. 타자가 멈춘 뒤에 후자가 따라간다.
  const [settled, setSettled] = useState('')
  const [cursor, setCursor] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const activeRow = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // 스크린리더용 이름표. 포커스는 입력칸에 둔 채 커서가 가리키는 줄을 id 로 알린다(콤보박스 패턴).
  const listId = useId()
  const optionId = (index: number) => `${listId}-${index}`

  // 대화상자 규약(12 UI 청사진 §8): 포커스 가둠·Esc 닫기·닫힐 때 포커스 복귀. 모달과 같은 훅.
  // 부모가 열릴 때마다 새로 마운트하므로 늘 "열린" 상태로 부른다.
  useFocusTrap(true, panelRef, onClose)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // 폰 폭의 시트는 쓸어내리면 닫힌다(노션 앱). 목록이 맨 위가 아니면 먼저 목록이 굴러간다(`touchIntent`).
  // 브라우저 스크롤을 막아야 해서 passive 가 아닌 touchmove 를 직접 단다(문서 패널 바텀시트와 같은 방식).
  const [closing, setClosing] = useState(false)
  const justDragged = useRef(false)
  const close = useEffectEvent(onClose)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let mode: 'idle' | 'wait' | ReturnType<typeof touchIntent> = 'idle'
    let id = 0
    let startX = 0
    let startY = 0
    let samples: { y: number; t: number }[] = []
    const same = (list: TouchList) => [...list].find((t) => t.identifier === id)
    const slide = (dy: number, transition = '') => {
      el.style.transition = transition
      el.style.transform = dy ? `translateY(${dy}px)` : ''
    }
    let leaving = false
    const onStart = (e: TouchEvent) => {
      // 끌던 줄이 목록에서 빠지면 touchend 가 여기까지 안 올라온다. 새 손짓이 오면 끌던 시트부터 돌려놓는다.
      if (mode === 'sheet') slide(0, SNAP_BACK)
      mode = 'idle'
      if (leaving || e.touches.length > 1 || !matchMedia('(max-width: 639.98px)').matches) return
      const touch = e.changedTouches[0]
      id = touch.identifier
      startX = touch.clientX
      startY = touch.clientY
      samples = []
      mode = 'wait'
    }
    const onMove = (e: TouchEvent) => {
      const touch = same(e.touches)
      if (!touch || mode === 'idle' || mode === 'scroll') return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (mode === 'wait') {
        if (Math.hypot(dx, dy) < 8) return
        const list = scrollerRef.current
        mode = touchIntent(dx, dy, list?.contains(e.target as Node) ? list : null)
        if (mode === 'scroll') return
      }
      e.preventDefault()
      if (mode !== 'sheet') return
      const t = performance.now()
      samples = [...samples.filter((s) => t - s.t < 200), { y: touch.clientY, t }]
      slide(Math.max(0, dy))
    }
    const onEnd = (e: TouchEvent) => {
      const touch = same(e.changedTouches)
      if (!touch || mode === 'idle') return
      const dragged = mode === 'sheet'
      mode = 'idle'
      if (!dragged) return
      // 10~15px 짧게 끌어도 사파리는 탭으로 쳐 click 을 보낼 수 있다. 그 줄로 넘어가지 않게 삼킨다(아래 onClickCapture).
      justDragged.current = true
      // 속도는 위로 + 다. 위로 튕겼으면 많이 내렸어도 되돌리고, 아래로 튕겼거나 충분히 내렸으면 닫는다.
      const v = e.type === 'touchcancel' ? 0 : releaseSpeed(samples, performance.now())
      const dy = touch.clientY - startY
      if (e.type === 'touchcancel' || v > 0.5 || (dy < SWIPE_CLOSE_PX && v > -0.5)) {
        return slide(0, SNAP_BACK)
      }
      leaving = true
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return close()
      setClosing(true)
      el.style.transition = 'transform 200ms ease-in'
      // 시트 높이(100%)가 아니라 화면 높이만큼: 짧은 시트는 100% 로는 화면 가운데서 멈춘다.
      el.style.transform = 'translateY(100dvh)'
      window.setTimeout(close, 200)
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

  const { data, isFetching, isError } = useSearch(settled)
  const { data: channels } = useChannels()
  const searching = query.trim().length > 0
  // 타자가 멈추기 전에는 아직 보내지도 않았다. 그 사이 "없습니다" 가 번쩍이면 안 된다.
  const pending = isFetching || settled !== query.trim()

  const navItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const allowed = visibleNav(ALL_NAV, role)
    return q ? allowed.filter((item) => item.label.toLowerCase().includes(q)) : allowed
  }, [query, role])

  /*
   * 그려지는 것과 커서가 세는 것이 같은 배열이어야 한다. 검색어를 지우면 결과 구획은
   * 사라지는데 직전 결과는 캐시에 남으므로(`keepPreviousData` 는 꺼진 쿼리에도 걸린다),
   * 둘을 따로 세면 아무것도 강조되지 않는 구간이 생기고 거기서 Enter 가 안 보이는 문서로 간다.
   */
  const rows = paletteRows(
    navItems,
    matchRooms(channels?.items ?? [], query),
    searching ? (data ?? []) : [],
  )
  const rooms = roomRows(rows)
  const hits = hitRows(rows)
  const askIndex = rows.length - 1
  // 필터로 목록이 줄어들면 커서가 범위를 벗어날 수 있다.
  const active = Math.min(cursor, rows.length - 1)

  // 결과가 20행까지 붙으면 강조된 행이 보이는 영역 밖으로 나간다. 커서가 어디 있는지
  // 모른 채 Enter 를 누르게 된다.
  // 중괄호 본문이어야 한다. 한 줄 화살표로 두면 scrollIntoView 의 반환값이 effect 의
  // 반환값이 되고, React 가 그것을 정리 함수로 알고 다음 실행 때 부른다(이슈 #137).
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const summary = !searching
    ? `화면 ${navItems.length}개`
    : pending
      ? '찾는 중'
      : isError
        ? `화면 ${navItems.length}개, 채팅방 ${rooms.length}개. 본문 검색에 실패했습니다.`
        : `화면 ${navItems.length}개, 채팅방 ${rooms.length}개, 검색 결과 ${hits.length}개`

  const go = (to: string, state?: AskState) => {
    onClose()
    void navigate(to, { state })
  }
  const ask = () => go('/ai', query.trim() ? { ask: query.trim() } : undefined)

  // 입력값 자체는 자르지 않는다. 이 값은 검색에만 쓰이는 게 아니라 "AI에게 물어보기" 가
  // 그대로 넘기는 문장이기도 하다. 검색 API 의 200자 제한은 `useSearch` 가 혼자 본다.
  const onType = (value: string) => {
    setQuery(value)
    setCursor(0)
    window.clearTimeout(timer.current)
    // 다듬어서 넘긴다. "찾는 중" 은 `settled !== query.trim()` 으로 가려서, 끝 공백이 남으면 영영 찾는 중이다.
    timer.current = window.setTimeout(() => setSettled(value.trim()), TYPING_PAUSE_MS)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Esc 는 useFocusTrap 의 document 리스너가 닫는다.
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((active + 1) % rows.length)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((active - 1 + rows.length) % rows.length)
    }
    // 한글 조합 확정 Enter 는 거른다(Textarea 와 같은 규약).
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const row = rows[active]
      if (row.kind === 'ask') ask()
      else if (row.kind === 'nav') go(row.nav.to)
      else if (row.kind === 'room') go(`/chat/${row.room.id}`)
      else go(row.hit.to)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-4 sm:px-4 sm:pt-[12vh]">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        // fixed: 아이폰 사파리가 시간 표시 줄도 같이 어둡게 칠한다(Modal 의 그림자 주석).
        // 시트가 내려가기 시작하면 바로 뺀다(같은 주석, 페이드하면 막대 색이 끊기며 따라온다).
        className={cn('fixed inset-0 bg-black/40', closing && 'hidden')}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="통합 검색"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDownCapture={() => {
          justDragged.current = false
        }}
        onClickCapture={(e) => {
          if (!justDragged.current) return
          justDragged.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        // 폰: 높이는 내용만큼(결과가 많으면 화면 아래까지), 빈 자리는 어두운 배경이 보인다(사용자 결정, 꽉 찬 시트의 흰 여백 대신).
        // 올라오는 애니메이션은 시트 높이가 아니라 화면 높이만큼 아래에서 시작한다(짧은 시트가 제자리 바로 밑에서 솟지 않게).
        className="border-line bg-surface relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none max-sm:motion-safe:animate-sheet-far-in sm:max-w-xl sm:rounded-xl"
      >
        {/* 쓸어내려 닫을 수 있다는 표시. 끌기는 시트 어디서든 된다(위 touchmove). */}
        <div aria-hidden="true" className="flex justify-center pt-2 sm:hidden">
          <span className="bg-line-strong h-1 w-9 rounded-full" />
        </div>
        <div className="border-line flex items-center gap-3 border-b px-4">
          <Search className="text-subtle size-4.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => onType(e.target.value)}
            role="combobox"
            aria-label="검색어"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={optionId(active)}
            placeholder="문서·채팅·게시글 검색, 채팅방·화면 이동…"
            // 터치 기기에서 16px: 아이폰 사파리는 그보다 작은 글자의 입력칸을 누르면 화면을 확대한다(공용 Input 과 같은 이유).
            className="text-fg placeholder:text-subtle h-13 flex-1 bg-transparent text-sm outline-none pointer-coarse:text-base"
          />
        </div>

        {/* 결과가 바뀔 때마다 개수를 읽어 준다. 목록 안의 "없습니다"·"찾는 중…" 은 같은 내용이라
            스크린리더에게서 감춘다(aria-hidden). */}
        <p aria-live="polite" className="sr-only">
          {summary}
        </p>

        <div
          id={listId}
          role="listbox"
          aria-label="검색 결과"
          className="flex min-h-0 flex-1 flex-col sm:max-h-80 sm:flex-none"
        >
          <div ref={scrollerRef} className="min-h-0 overflow-y-auto p-1.5">
            {/* 검색어가 화면 이름과 안 맞으면 묶음을 통째로 뺀다. 빈 안내가 본문 결과를 밀어 내렸다(폰에서 48px). */}
            {navItems.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-nav`}>
                <p
                  id={`${listId}-nav`}
                  role="presentation"
                  className="text-subtle px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase"
                >
                  화면 이동
                </p>
                {navItems.map((item, i) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.to}
                      ref={i === active ? activeRow : undefined}
                      role="option"
                      id={optionId(i)}
                      aria-selected={i === active}
                      tabIndex={-1}
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(item.to)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                        i === active ? 'bg-accent-soft text-accent' : 'text-muted',
                      )}
                    >
                      <Icon className="size-4.5 shrink-0" />
                      <span>{item.label}</span>
                      {i === active && <CornerDownLeft className="ml-auto size-3.5" />}
                    </button>
                  )
                })}
              </div>
            )}

            {rooms.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-rooms`}>
                <p
                  id={`${listId}-rooms`}
                  role="presentation"
                  className="text-subtle px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase"
                >
                  채팅방
                </p>
                {rooms.map((room, i) => {
                  const index = navItems.length + i
                  const Icon = room.is_dm ? AtSign : room.is_private ? Lock : Hash
                  return (
                    <button
                      key={room.id}
                      ref={index === active ? activeRow : undefined}
                      role="option"
                      id={optionId(index)}
                      aria-selected={index === active}
                      tabIndex={-1}
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(`/chat/${room.id}`)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                        index === active ? 'bg-accent-soft text-accent' : 'text-muted',
                      )}
                    >
                      <Icon className="size-4.5 shrink-0" />
                      <span className="truncate">{room.name}</span>
                      <span className="text-subtle shrink-0 text-[11px]">
                        {room.is_dm ? 'DM' : room.is_private ? '비공개 채널' : '채널'}
                      </span>
                      {index === active && <CornerDownLeft className="ml-auto size-3.5 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}

            {searching && (
              <div role="group" aria-labelledby={`${listId}-hits`}>
                <p
                  id={`${listId}-hits`}
                  role="presentation"
                  className="text-subtle px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase"
                >
                  문서·채팅·게시글
                  {pending && (
                    <span aria-hidden="true" className="ml-1.5 font-normal normal-case">
                      찾는 중…
                    </span>
                  )}
                </p>
                {isError && !pending && (
                  <p aria-hidden="true" className="text-muted px-2.5 py-4 text-center text-sm">
                    검색에 실패했습니다. 잠시 뒤에 다시 시도해 주세요.
                  </p>
                )}
                {!isError && hits.length === 0 && !pending && (
                  <p aria-hidden="true" className="text-muted px-2.5 py-4 text-center text-sm">
                    “{query.trim()}” 에 맞는 내용이 없습니다.
                  </p>
                )}
                {hits.map((hit, i) => {
                  const index = navItems.length + rooms.length + i
                  return (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      ref={index === active ? activeRow : undefined}
                      role="option"
                      id={optionId(index)}
                      aria-selected={index === active}
                      tabIndex={-1}
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(hit.to)}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-left text-sm',
                        index === active ? 'bg-accent-soft text-accent' : 'text-muted',
                      )}
                    >
                      <HitRow hit={hit} active={index === active} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 목록이 길어도 항상 보이게 스크롤 영역 밖에 둔다. 안에 두면 위 선이 스크롤바 폭만큼
              덜 뻗고, 방향키로 고른 줄이 이 칸 뒤로 숨는다. */}
          <div role="group" aria-label="AI" className="border-line border-t p-1.5">
            <button
              ref={active === askIndex ? activeRow : undefined}
              role="option"
              id={optionId(askIndex)}
              aria-selected={active === askIndex}
              tabIndex={-1}
              type="button"
              onMouseEnter={() => setCursor(askIndex)}
              onClick={ask}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                active === askIndex ? 'bg-accent-soft text-accent' : 'text-muted',
              )}
            >
              <Sparkles className="size-4.5 shrink-0" />
              <span className="truncate">
                AI에게 물어보기
                {query.trim() && (
                  <span className={cn('ml-1.5 font-medium', active !== askIndex && 'text-fg')}>
                    “{query.trim()}”
                  </span>
                )}
              </span>
              {active === askIndex && <CornerDownLeft className="ml-auto size-3.5 shrink-0" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
