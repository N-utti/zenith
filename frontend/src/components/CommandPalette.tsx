import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PRIMARY_NAV, SECONDARY_NAV } from '@/app/navigation'

/**
 * ⌘K 통합검색의 껍데기. 지금은 화면 이동만 하고,
 * 문서·채팅 검색 결과는 백엔드 `/api/search` 연동 시 두 번째 섹션으로 붙인다.
 *
 * 열릴 때마다 부모가 새로 마운트하므로 초기화용 effect가 필요 없다.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const items = useMemo(() => {
    const all = [...PRIMARY_NAV, ...SECONDARY_NAV]
    const q = query.trim().toLowerCase()
    return q ? all.filter((item) => item.label.toLowerCase().includes(q)) : all
  }, [query])

  // 필터로 목록이 줄어들면 커서가 범위를 벗어날 수 있다.
  const active = Math.min(cursor, Math.max(items.length - 1, 0))

  const go = (to: string) => {
    onClose()
    void navigate(to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose()
    if (!items.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((active + 1) % items.length)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((active - 1 + items.length) % items.length)
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      go(items[active].to)
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

          <p className="text-subtle border-line mt-1.5 border-t px-2.5 py-3 text-xs">
            문서·채팅 본문 검색은 백엔드 <code className="font-mono">/api/search</code> 연동 후
            활성화됩니다. 권한 밖 문서는 결과에서 제외됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
