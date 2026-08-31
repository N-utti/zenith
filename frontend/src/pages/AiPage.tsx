import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { AiComposer } from '@/features/ai/AiComposer'
import { AiHistoryPanel } from '@/features/ai/AiHistoryPanel'
import { Conversation } from '@/features/ai/Conversation'
import { SourcesPanel } from '@/features/ai/SourcesPanel'
import { useAiMeta, useAsk, useConversation, useResetConversation } from '@/features/ai/api'

/** 추론이 사내망을 벗어나지 않는다는 표시. 이 화면에서 가장 중요한 한 줄이다. */
function LocalLlmBadge() {
  return (
    <span className="border-line bg-success/10 text-success ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:flex">
      <span className="bg-success size-1.5 rounded-full" />
      로컬 LLM · 사내 서버 · 오프라인
    </span>
  )
}

export function AiPage() {
  const { data: meta } = useAiMeta()
  const { data, isPending, isError } = useConversation()
  const ask = useAsk()
  const reset = useResetConversation()
  const toast = useToast()
  const [seed, setSeed] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const messages = data?.items ?? []

  return (
    <div className="flex h-full">
      <AiHistoryPanel meta={meta} onPick={(question) => setSeed(question)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface flex h-13 shrink-0 items-center gap-2.5 border-b px-5 py-2.5">
          <h1 className="text-fg text-[15.5px] font-bold">AI 어시스턴트</h1>
          <span className="text-subtle hidden text-xs sm:inline">사내 위키 기반 답변</span>
          <LocalLlmBadge />
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReset(true)}
              aria-label="대화 지우기"
              className="ml-2 shrink-0 px-2"
              title="대화 지우기"
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
        </header>

        {isPending && (
          <div className="grid flex-1 place-items-center">
            <Spinner className="size-6" />
          </div>
        )}
        {isError && (
          <p className="text-subtle grid flex-1 place-items-center text-sm">
            대화를 불러오지 못했습니다.
          </p>
        )}

        {data && <Conversation messages={messages} generating={ask.isPending} />}

        {ask.isError && (
          <p className="text-danger px-5 pb-2 text-center text-xs">
            답변을 받지 못했습니다. 다시 시도해 주세요.
          </p>
        )}

        <AiComposer
          key={seed ?? 'composer'}
          meta={meta}
          initialText={seed ?? ''}
          disabled={ask.isPending}
          onSend={(prompt) => {
            setSeed(null)
            ask.mutate(prompt)
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
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmReset(false)
                    toast.success('대화를 지웠습니다.')
                  },
                  onError: () => toast.error('대화를 지우지 못했습니다.'),
                })
              }
            >
              지우기
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm">
          지식 소스와 최근 질문 목록은 그대로 남습니다.
        </p>
      </Modal>
    </div>
  )
}
