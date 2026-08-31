import { useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem {
  key: string
  label: string
  /** 대기 건수 같은 숫자. 0이면 배지를 그리지 않는다 — "0건"은 알릴 내용이 아니다. */
  count?: number
}

/**
 * 탭 (WAI-ARIA tabs 패턴).
 *
 * 예외 근무 신청(재택·외근·출장 / 연장근로)과 승인 대기함(휴가·예외근무·연장·정정)이
 * 쓴다 — 10 근태 설계서 SCR-ATT-03 · SCR-ATT-05.
 *
 * **값을 밖에서 줄 수 있다.** `value`를 넘기면 제어 컴포넌트가 되고, 안 넘기면
 * 스스로 상태를 든다. 승인 알림이 "휴가 승인 요청"에서 대기함의 휴가 탭으로 바로
 * 들어와야 하는데, 탭이 내부 state만 쓰면 그 링크를 만들 수 없다. 호출부가
 * `useSearchParams`로 묶으면 새로고침·뒤로가기·링크 공유가 전부 산다.
 *
 * 키보드는 ARIA 규약대로 **자동 활성화**다 — ←→ 로 옮기면 그 탭이 바로 열린다.
 * 탭 개수가 적고 패널이 이미 받아 둔 데이터를 그리기 때문에, 이동과 선택을
 * 나누면(수동 활성화) 오히려 Enter를 한 번 더 눌러야 하는 부담만 남는다.
 */
export function Tabs({
  items,
  value,
  onChange,
  children,
  className,
}: {
  items: TabItem[]
  /** 넘기면 제어 컴포넌트. 없으면 첫 탭에서 시작해 스스로 상태를 든다. */
  value?: string
  onChange?: (key: string) => void
  /** 현재 탭 키를 받아 패널 내용을 그린다. */
  children: (key: string) => ReactNode
  className?: string
}) {
  const baseId = useId()
  const [internal, setInternal] = useState(items[0]?.key ?? '')
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  // 제어 중이라도 넘어온 값이 목록에 없으면(잘못된 URL 파라미터 등) 첫 탭으로 접는다.
  const requested = value ?? internal
  const active = items.some((item) => item.key === requested) ? requested : (items[0]?.key ?? '')

  const select = (key: string) => {
    if (value === undefined) setInternal(key)
    onChange?.(key)
  }

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = items.length - 1
    let next: number
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else return

    event.preventDefault()
    const key = items[next].key
    select(key)
    refs.current[key]?.focus()
  }

  return (
    <div className={className}>
      <div role="tablist" className="border-line flex gap-1 overflow-x-auto border-b">
        {items.map((item, index) => {
          const selected = item.key === active
          return (
            <button
              key={item.key}
              ref={(node) => {
                refs.current[item.key] = node
              }}
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.key}`}
              // 선택된 탭 하나만 탭 순서에 남긴다(roving tabindex). 그러지 않으면
              // Tab 키가 탭 개수만큼 멈춰 서서 패널까지 가는 길이 길어진다.
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.key)}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                'relative -mb-px shrink-0 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                'border-b-2',
                selected
                  ? 'border-accent text-fg'
                  : 'text-muted hover:text-fg border-transparent',
              )}
            >
              {item.label}
              {item.count ? (
                <span
                  className={cn(
                    'ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                    selected ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        tabIndex={0}
        className="pt-4 focus-visible:outline-none"
      >
        {children(active)}
      </div>
    </div>
  )
}
