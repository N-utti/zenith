import { Folder } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useTree } from '@/features/docs/api'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { usePanelWidth } from '@/lib/usePanelWidth'
import { topFolders } from './scope'
import { useAiSessions } from './api'

/**
 * AI 화면의 좌패널. 와이어프레임은 이 내용을 전역 사이드바 자리에 넣지만,
 * 우리 셸은 사이드바가 항상 같은 것을 보여준다. 채팅의 채널 목록과 같은 자리에 둔다.
 *
 * 대화 목록은 서버가 저장한 내 대화다(`GET /ai/sessions`, 백엔드 #430). 누르면 그 대화로 옮겨 되읽는다.
 * 문서 질문창의 대화도 섞여 있다. 서버가 가르는 필드를 주지 않는다.
 */
export function AiHistoryPanel({
  current,
  onPick,
}: {
  /** 지금 보는 대화의 세션 id. */
  current: string
  onPick: (sessionId: string) => void
}) {
  const { data: sessions = [], isSuccess } = useAiSessions()
  // 입력창의 지식 소스 드롭다운과 같은 목록(사이드바 트리의 최상위 폴더).
  const folders = topFolders(useTree().data)
  const panel = usePanelWidth('zenith.aiHistoryWidth', 240, 180, 400, 0.2)

  return (
    <>
      <nav
        style={{ width: panel.width, maxWidth: panel.maxWidth }}
        className="border-line bg-surface hidden shrink-0 flex-col overflow-y-auto border-r md:flex"
      >
        <div className="space-y-5 p-3">
          <section>
            <h2 className="text-subtle mb-1.5 px-2.5 text-[11px] font-bold tracking-[0.08em]">
              최근 대화
            </h2>
            {isSuccess && sessions.length === 0 && (
              <p className="text-subtle px-2.5 text-[12px]">아직 대화가 없습니다.</p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                aria-current={session.id === current ? 'true' : undefined}
                onClick={() => session.id !== current && onPick(session.id)}
                className={cn(
                  'hover:bg-surface-hover hover:text-fg block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                  session.id === current ? 'bg-surface-hover text-fg' : 'text-muted',
                )}
              >
                <span className="block truncate">{session.title}</span>
                <span className="text-subtle text-[10.5px]">
                  {session.pending ? '답변 만드는 중' : formatRelative(session.updated_at)}
                </span>
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
      <ResizeHandle panel={panel} side="right" label="질문 목록 폭" className="hidden md:block" />
    </>
  )
}
