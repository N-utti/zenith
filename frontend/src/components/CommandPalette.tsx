import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CornerDownLeft, Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ALL_NAV } from '@/app/navigation'
import type { AskState } from '@/features/ai/types'

/**
 * ⌘K 통합검색의 껍데기. 지금은 화면 이동만 하고,
 * 문서·채팅 검색 결과는 백엔드 `/api/search` 연동 시 두 번째 섹션으로 붙인다.
 *
 * 열릴 때마다 부모가 새로 마운트하므로 초기화용 effect가 필요 없다.
 *
 * 맨 아래 "AI에게 물어보기"(05 SCR-00)는 검색어를 그대로 /ai 컴포저에 채운다. 화면 목록이 비어도
 * 이 행은 남아 Enter 가 항상 어딘가로 간다.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? ALL_NAV.filter((item) => item.label.toLowerCase().includes(q)) : ALL_NAV
  }, [query])

  // 키보드 커서는 화면 목록 뒤에 AI 행 하나를 더 센다.
  const askIndex = items.length
  const count = items.length + 1
  // 필터로 목록이 줄어들면 커서가 범위를 벗어날 수 있다.
  const active = Math.min(cursor, count - 1)

  const go = (to: string, state?: AskState) => {
    onClose()
    void navigate(to, { state })
  }
  const ask = () => go('/ai', query.trim() ? { ask: query.trim() } : undefined)

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
      else go(items[active].to)
    }
  }

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
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            placeholder="문서·채팅·사람 검색 또는 화면 이동…"
            className="text-fg placeholder:text-subtle h-13 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          <p className="text-subtle px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            화면 이동
          </p>
          {items.length === 0 && (
            <p className="text-muted px-2.5 py-6 text-center text-sm">일치하는 화면이 없습니다.</p>
          )}
          {items.map((item, i) => {
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

          <p className="text-subtle px-2.5 py-3 text-xs">
            문서·채팅 본문 검색은 백엔드 <code className="font-mono">/api/search</code> 연동 후
            활성화됩니다. 권한 밖 문서는 결과에서 제외됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
