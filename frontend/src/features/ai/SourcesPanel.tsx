import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { sourceKind, sourceTo, webLink } from './source'
import type { AiMessage, Citation, CitationFocus } from './types'

export function SourceCard({
  source,
  activeTick,
}: {
  source: Citation
  /** 눌린 각주의 클릭 일련번호. 값이 있으면 이 카드가 켜진다. */
  activeTick?: number
}) {
  const active = activeTick !== undefined
  const ref = useRef<HTMLAnchorElement & HTMLDivElement>(null)
  const kind = sourceKind(source)
  const to = sourceTo(source)
  const web = webLink(source)
  // 각주를 누르면 그 카드로 스크롤하고 포커스를 옮긴다(키보드·스크린리더도 이동을 안다).
  // 숨겨진(display:none) 카드에서는 아무 일도 없다.
  useEffect(() => {
    if (activeTick === undefined) return
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    ref.current?.focus({ preventScroll: true })
  }, [activeTick])

  const className = cn(
    'bg-surface block rounded-xl border p-3.5 transition-colors',
    active ? 'border-accent' : to || web ? 'border-line hover:border-line-strong' : 'border-line',
  )
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded px-1.5 text-[11px] font-bold',
            active ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted',
          )}
        >
          {source.n}
        </span>
        <span className="text-fg min-w-0 flex-1 truncate text-[13px] font-semibold">
          {source.title}
        </span>
        <kind.icon className="text-subtle size-3.5 shrink-0" aria-hidden />
        {/* 웹 카드의 제목은 웹 내용을 읽은 모델이 정한다. 사내 근거로 착각하지 않게 종류를 눈에 보이게 둔다. */}
        {web ? (
          <span className="text-subtle shrink-0 text-[11px]">{kind.label}</span>
        ) : (
          <span className="sr-only">{kind.label}</span>
        )}
      </div>
      <p className="text-muted mt-2 text-xs leading-relaxed">&ldquo;{source.quote}&rdquo;</p>
      {web ? (
        // 바깥으로 나가는 링크다. 어디로 가는지 호스트를 크게 보인다.
        <p className="text-muted mt-2 flex items-center gap-1 text-xs font-semibold">
          {web.host}
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(새 창)</span>
        </p>
      ) : (
        <p className="text-subtle mt-2 text-[10.5px]">{source.path}</p>
      )}
    </>
  )

  // 웹 출처는 새 창으로. 데스크톱 앱에서는 `installExternalLinkHandler` 가 기본 브라우저로 넘긴다.
  if (web) {
    return (
      <a
        ref={ref}
        href={web.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-current={active || undefined}
        className={className}
      >
        {body}
      </a>
    )
  }

  // 갈 곳을 모르는 근거는 링크로 그리지 않는다. 각주를 눌렀을 때 초점은 그대로 받는다.
  if (!to) {
    return (
      <div ref={ref} tabIndex={-1} aria-current={active || undefined} className={className}>
        {body}
      </div>
    )
  }
  return (
    <Link ref={ref} to={to} aria-current={active || undefined} className={className}>
      {body}
    </Link>
  )
}

/** 05 SCR-06 근거 패널 하단 고지. 몇 건이 빠졌는지는 서버가 알려주지 않는다(존재 자체를 숨긴다). */
export function ExcludedNote() {
  return (
    <p className="text-subtle flex items-start gap-1.5 text-[11px] leading-relaxed">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
      <span>권한 없는 문서와 게시글은 근거에서 자동 제외됩니다.</span>
    </p>
  )
}

/**
 * 우측 근거 패널. 근거는 문서와 게시글이다. `lg` 미만에서는 숨고, 대신 답변 아래 인라인 목록이 나온다.
 *
 * 한 답변의 근거만 보여준다. 대화 전체를 쌓으면 어느 문장의 근거인지 잃는다.
 * 기본은 마지막 답변이고, 예전 답변의 각주를 누르면 그 답변으로 바뀐다.
 */
export function SourcesPanel({
  messages,
  focus,
}: {
  messages: AiMessage[]
  focus: CitationFocus | null
}) {
  const shown =
    (focus && messages.find((m) => m.id === focus.messageId)) ??
    [...messages].reverse().find((m) => m.role === 'assistant')
  const sources = shown?.citations ?? []
  const activeFocus = shown && focus?.messageId === shown.id ? focus : null

  return (
    <aside className="border-line bg-canvas hidden w-72 shrink-0 flex-col border-l lg:flex">
      <header className="border-line flex h-11 shrink-0 items-center border-b px-4">
        <h2 className="text-fg text-[13.5px] font-semibold">
          근거 <span className="text-subtle font-normal">{sources.length}</span>
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {sources.length === 0 ? (
          <p className="text-subtle text-center text-xs leading-relaxed">
            질문하면 답변의 근거가 된 문서와 게시글이
            <br />
            여기에 표시됩니다.
          </p>
        ) : (
          <>
            <ul className="space-y-3.5">
              {sources.map((source) => (
                <li key={source.n}>
                  <SourceCard
                    source={source}
                    activeTick={activeFocus?.n === source.n ? activeFocus.tick : undefined}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 px-2">
              <ExcludedNote />
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
