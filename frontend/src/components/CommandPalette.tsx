import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CornerDownLeft, FileText, MessagesSquare, Megaphone, Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { ALL_NAV } from '@/app/navigation'
import { SEARCH_MAX, useSearch } from '@/features/search/api'
import { parseSnippet } from '@/features/search/snippet'
import { SEARCH_TYPE_LABEL, type SearchHit } from '@/features/search/types'
import type { AskState } from '@/features/ai/types'

/** 글자를 칠 때마다 서버를 부르지 않는다. 멈춘 뒤에 한 번. */
const TYPING_PAUSE_MS = 200

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
          <mark key={i} className="bg-accent-soft text-accent rounded-sm bg-transparent font-semibold">
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
  const Icon = HIT_ICONS[hit.type]
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
 * ⌘K 통합검색. 화면 이동과 본문 검색(`GET /search`)을 한 목록에 놓는다.
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
  const [query, setQuery] = useState('')
  // 화면에 보이는 값과 서버에 보내는 값을 나눈다. 타자가 멈춘 뒤에 후자가 따라간다.
  const [settled, setSettled] = useState('')
  const [cursor, setCursor] = useState(0)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const { data: hits = [], isFetching } = useSearch(settled)

  const navItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? ALL_NAV.filter((item) => item.label.toLowerCase().includes(q)) : ALL_NAV
  }, [query])

  // 키보드 커서는 세 덩어리를 하나로 이어 센다. 화면 이동 → 검색 결과 → AI 행.
  const askIndex = navItems.length + hits.length
  const count = askIndex + 1
  // 필터로 목록이 줄어들면 커서가 범위를 벗어날 수 있다.
  const active = Math.min(cursor, count - 1)

  const go = (to: string, state?: AskState) => {
    onClose()
    void navigate(to, { state })
  }
  const ask = () => go('/ai', query.trim() ? { ask: query.trim() } : undefined)

  const onType = (value: string) => {
    setQuery(value.slice(0, SEARCH_MAX))
    setCursor(0)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSettled(value.slice(0, SEARCH_MAX)), TYPING_PAUSE_MS)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((active + 1) % count)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((active - 1 + count) % count)
    }
    // 한글 조합 확정 Enter 는 거른다(Textarea 와 같은 규약).
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (active === askIndex) ask()
      else if (active < navItems.length) go(navItems[active].to)
      else go(hits[active - navItems.length].to)
    }
  }

  const searching = query.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="통합 검색"
        onKeyDown={onKeyDown}
        className="border-line bg-surface relative w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl"
      >
        <div className="border-line flex items-center gap-3 border-b px-4">
          <Search className="text-subtle size-4.5 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onType(e.target.value)}
            placeholder="문서·채팅·사람 검색 또는 화면 이동…"
            className="text-fg placeholder:text-subtle h-13 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          <p className="text-subtle px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            화면 이동
          </p>
          {navItems.length === 0 && (
            <p className="text-muted px-2.5 py-6 text-center text-sm">일치하는 화면이 없습니다.</p>
          )}
          {navItems.map((item, i) => {
            const Icon = item.icon
            return (
              <button
                key={item.to}
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

          {searching && (
            <>
              <p className="text-subtle px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                문서·채팅·게시글
                {isFetching && <span className="ml-1.5 font-normal normal-case">찾는 중…</span>}
              </p>
              {hits.length === 0 && !isFetching && (
                <p className="text-muted px-2.5 py-4 text-center text-sm">
                  “{query.trim()}” 에 맞는 내용이 없습니다.
                </p>
              )}
              {hits.map((hit, i) => {
                const index = navItems.length + i
                return (
                  <button
                    key={`${hit.type}-${hit.id}`}
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
            </>
          )}

          {/* 목록이 길어도 항상 보이게 스크롤 영역 바닥에 붙인다. */}
          <div className="border-line bg-surface sticky bottom-0 mt-1.5 border-t pt-1.5">
            <button
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
