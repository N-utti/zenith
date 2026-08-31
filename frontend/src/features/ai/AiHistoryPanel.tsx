import { FileText, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { formatRelative } from '@/lib/datetime'
import { ROLE_LABEL } from '@/types'
import type { AiMeta } from './types'

/**
 * AI 화면의 좌패널. 와이어프레임은 이 내용을 전역 사이드바 자리에 넣지만,
 * 우리 셸은 사이드바가 항상 같은 것을 보여준다 — 채팅의 채널 목록과 같은 자리에 둔다.
 */
export function AiHistoryPanel({
  meta,
  onPick,
}: {
  meta: AiMeta | undefined
  onPick: (question: string) => void
}) {
  return (
    <nav className="border-line bg-surface hidden w-60 shrink-0 flex-col overflow-y-auto border-r md:flex">
      <div className="space-y-5 p-3">
        <section>
          <h2 className="text-subtle mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
            최근 질문
          </h2>
          {(meta?.recent ?? []).map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => onPick(question.text)}
              className="text-muted hover:bg-surface-hover hover:text-fg block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors"
            >
              <span className="block truncate">{question.text}</span>
              <span className="text-subtle text-[10.5px]">{formatRelative(question.askedAt)}</span>
            </button>
          ))}
        </section>

        <section>
          <h2 className="text-subtle mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
            지식 소스
          </h2>
          {(meta?.sources ?? [])
            .filter((source) => source.id !== 'all')
            .map((source) => (
              <div
                key={source.id}
                title={source.allowed ? undefined : '열람 권한이 없습니다'}
                className={
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ' +
                  (source.allowed ? 'text-muted' : 'text-subtle cursor-not-allowed opacity-55')
                }
              >
                {source.allowed ? (
                  <FileText className="size-3.5 shrink-0" />
                ) : (
                  <Lock className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{source.label}</span>
                {source.minRole && (
                  <Badge className="ml-auto shrink-0">{ROLE_LABEL[source.minRole]}</Badge>
                )}
              </div>
            ))}
          <p className="text-subtle mt-2 px-2.5 text-[11px] leading-relaxed">
            권한 밖 소스의 문장은 답변 근거에서 자동으로 빠집니다.
          </p>
        </section>
      </div>
    </nav>
  )
}
