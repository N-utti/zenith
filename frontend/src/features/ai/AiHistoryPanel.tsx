import { Folder } from 'lucide-react'
import { formatRelative } from '@/lib/datetime'
import { useTree } from '@/features/docs/api'
import { topFolders } from './scope'
import type { AiMessage } from './types'

/**
 * AI 화면의 좌패널. 와이어프레임은 이 내용을 전역 사이드바 자리에 넣지만,
 * 우리 셸은 사이드바가 항상 같은 것을 보여준다. 채팅의 채널 목록과 같은 자리에 둔다.
 *
 * 최근 질문은 이 대화의 내 질문이다. 서버가 세션을 저장하지 않으니 그 밖의 이력은 없다.
 */
export function AiHistoryPanel({
  messages,
  onPick,
}: {
  messages: AiMessage[]
  onPick: (question: string) => void
}) {
  const recent = messages.filter((m) => m.role === 'user').slice(-5).reverse()
  // 입력창의 지식 소스 드롭다운과 같은 목록(사이드바 트리의 최상위 폴더).
  const folders = topFolders(useTree().data)

  return (
    <nav className="border-line bg-surface hidden w-60 shrink-0 flex-col overflow-y-auto border-r md:flex">
      <div className="space-y-5 p-3">
        <section>
          <h2 className="text-subtle mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
            최근 질문
          </h2>
          {recent.length === 0 && (
            <p className="text-subtle px-2.5 text-[12px]">아직 질문이 없습니다.</p>
          )}
          {recent.map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => onPick(question.body)}
              className="text-muted hover:bg-surface-hover hover:text-fg block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors"
            >
              <span className="block truncate">{question.body}</span>
              <span className="text-subtle text-[10.5px]">{formatRelative(question.createdAt)}</span>
            </button>
          ))}
        </section>

        <section>
          <h2 className="text-subtle mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
            지식 소스
          </h2>
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="text-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{folder.title}</span>
            </div>
          ))}
          <p className="text-subtle mt-2 px-2.5 text-[11px] leading-relaxed">
            권한 밖 문서의 문장은 서버가 답변 근거에서 자동으로 뺍니다.
          </p>
        </section>
      </div>
    </nav>
  )
}
