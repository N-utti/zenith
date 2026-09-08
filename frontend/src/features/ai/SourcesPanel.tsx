import { Link } from 'react-router'
import { FileText, ShieldCheck } from 'lucide-react'
import type { AiMessage, Citation } from './types'

export function SourceCard({ source }: { source: Citation }) {
  return (
    <Link
      to={`/docs/${source.doc_id}`}
      className="border-line bg-surface hover:border-line-strong block rounded-xl border p-3.5 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="bg-sunken text-muted rounded px-1.5 text-[11px] font-bold">{source.n}</span>
        <span className="text-fg min-w-0 flex-1 truncate text-[13px] font-semibold">
          {source.title}
        </span>
        <FileText className="text-subtle size-3.5 shrink-0" />
      </div>
      <p className="text-muted mt-2 text-xs leading-relaxed">&ldquo;{source.quote}&rdquo;</p>
      <p className="text-subtle mt-2 text-[10.5px]">{source.path}</p>
    </Link>
  )
}

/** 05 SCR-06 근거 패널 하단 고지. 몇 건이 빠졌는지는 서버가 알려주지 않는다(존재 자체를 숨긴다). */
export function ExcludedNote() {
  return (
    <p className="text-subtle flex items-start gap-1.5 text-[11px] leading-relaxed">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
      <span>권한 없는 문서는 근거에서 자동 제외됩니다.</span>
    </p>
  )
}

/**
 * 우측 근거 문서 패널. `lg` 미만에서는 숨고, 대신 답변 아래 인라인 목록이 나온다.
 *
 * 마지막 assistant 답변의 근거만 보여준다. 대화 전체를 쌓으면 어느 문장의 근거인지 잃는다.
 */
export function SourcesPanel({ messages }: { messages: AiMessage[] }) {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  const sources = last?.citations ?? []

  return (
    <aside className="border-line bg-canvas hidden w-72 shrink-0 flex-col border-l lg:flex">
      <header className="border-line flex h-11 shrink-0 items-center border-b px-4">
        <h2 className="text-fg text-[13.5px] font-semibold">
          근거 문서 <span className="text-subtle font-normal">{sources.length}</span>
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {sources.length === 0 ? (
          <p className="text-subtle text-center text-xs leading-relaxed">
            질문하면 답변의 근거가 된 문서가
            <br />
            여기에 표시됩니다.
          </p>
        ) : (
          <>
            <ul className="space-y-3.5">
              {sources.map((source) => (
                <li key={source.n}>
                  <SourceCard source={source} />
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
