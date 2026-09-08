import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/ToastContext'
import { AiComposer } from '@/features/ai/AiComposer'
import { AiHistoryPanel } from '@/features/ai/AiHistoryPanel'
import { Conversation } from '@/features/ai/Conversation'
import { SourcesPanel } from '@/features/ai/SourcesPanel'
import { useAiModels, useAsk } from '@/features/ai/api'
import { resetThread, useThread } from '@/features/ai/store'

/**
 * 무엇이 답하는지 밝힌다. ARCHITECTURE §6(2026-09-04): 1차 공급자는 Claude API 이고 호출은 서버가 한다.
 * 예전 "로컬 LLM · 오프라인" 문구는 이제 사실이 아니라 뺐다.
 */
function ProviderBadge() {
  return (
    <span className="border-line bg-success/10 text-success ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:flex">
      <span className="bg-success size-1.5 rounded-full" />
      Claude API · 사내 서버 경유
    </span>
  )
}

export function AiPage() {
  const { data: models } = useAiModels()
  const { messages } = useThread()
  const ask = useAsk()
  const toast = useToast()
  const [seed, setSeed] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  // 질문은 붙었는데 첫 토큰이 아직 안 왔을 때만 "생성 중" 을 보여준다. 그 뒤로는 말풍선이 자란다.
  const generating = ask.isPending && messages.at(-1)?.role === 'user'

  return (
    <div className="flex h-full">
      <AiHistoryPanel messages={messages} onPick={(question) => setSeed(question)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface flex h-13 shrink-0 items-center gap-2.5 border-b px-5 py-2.5">
          <h1 className="text-fg shrink-0 text-[15.5px] font-bold whitespace-nowrap">AI 어시스턴트</h1>
          <span className="text-subtle hidden text-xs sm:inline">사내 위키 기반 답변</span>
          <ProviderBadge />
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReset(true)}
              disabled={ask.isPending}
              aria-label="대화 지우기"
              className="ml-2 shrink-0 px-2"
              title="대화 지우기"
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
        </header>

        <Conversation messages={messages} generating={generating} streaming={ask.isPending} />

        {ask.isError && (
          <p className="text-danger px-5 pb-2 text-center text-xs">
            {ask.error.message || '답변을 받지 못했습니다. 다시 시도해 주세요.'}
          </p>
        )}

        <AiComposer
          key={seed ?? 'composer'}
          models={models ?? []}
          initialText={seed ?? ''}
          disabled={ask.isPending}
          onSend={(prompt, scope) => {
            setSeed(null)
            ask.mutate({ prompt, scope })
          }}
        />
      </div>

      <SourcesPanel messages={messages} />

      {/* 되돌릴 수 없는 동작이라 확인을 받는다. §4.2가 지목한 Modal의 첫 소비처다. */}
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="대화를 지울까요?"
        description="주고받은 질문과 답변이 모두 사라집니다. 되돌릴 수 없습니다."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>
              취소
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                resetThread()
                setConfirmReset(false)
                toast.success('대화를 지웠습니다.')
              }}
            >
              지우기
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm">최근 질문 목록도 함께 비워집니다.</p>
      </Modal>
    </div>
  )
}
