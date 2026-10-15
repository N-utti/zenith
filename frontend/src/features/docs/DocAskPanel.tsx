import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { useAsk } from '@/features/ai/api'
import { Conversation } from '@/features/ai/Conversation'
import { rejected } from '@/features/ai/scope'
import { createThreadStore } from '@/features/ai/store'
import type { CitationFocus } from '@/features/ai/types'
import { docKeys } from './api'

/**
 * 이 문서 하나를 놓고 AI 에게 묻는다(백엔드 #380 `scope: "doc:<문서 id>"`). 서버가 본문을 통째로
 * 프롬프트에 넣고, 검색은 전체에서 그대로 한다.
 *
 * 대화는 문서마다 따로다. `/ai` 의 대화와 섞으면 서버가 앞선 대화를 이어 보내 다른 문서의 맥락이 따라온다.
 * 이 패널은 다른 탭을 보는 동안에도 숨겨진 채 살아 있다(`DocSurface`). 답변이 흐르는 중에 탭을
 * 옮겼다 와도 요청 상태(보내기 잠금·생성 중·실패 사유)와 쓰던 질문이 남아야 한다.
 */
export function DocAskPanel({
  docId,
  aiSource,
}: {
  docId: string
  /** 'AI 근거로 쓰기'가 꺼진 문서는 서버가 422 로 거절한다. 보내기 전에 막는다. */
  aiSource: boolean
}) {
  const [store] = useState(createThreadStore)
  // 문서를 떠나면(다른 문서·로그아웃) 대화를 비운다. 세션 id 가 바뀌어 받던 답변도 다음 조각에서 닫히고,
  // 등급별 근거 인용문이 남지 않는다.
  useEffect(() => () => store.reset(), [store])
  const { messages, status } = store.useThread()
  const ask = useAsk(store)
  // 서버가 이 문서를 거절했으면(다른 사람이 근거를 껐거나 휴지통에 넣음) 문서 정보가 낡은 것이다.
  // 다시 받으면 입력창이 안내 문구로, 휴지통이면 읽기 전용 화면으로 바뀐다.
  const qc = useQueryClient()
  const mutate = (vars: Parameters<typeof ask.mutate>[0]) =>
    ask.mutate(vars, {
      onError: (error) => {
        if (rejected(error)) void qc.invalidateQueries({ queryKey: docKeys.detail(docId) })
      },
    })
  const [text, setText] = useState('')
  const [focus, setFocus] = useState<CitationFocus | null>(null)
  // `Conversation` 의 지난 답변이 조각마다 다시 그려지지 않게 붙잡아 둔다(`AiPage` 와 같다).
  const cite = useCallback(
    (next: Omit<CitationFocus, 'tick'>) =>
      setFocus((prev) => ({ ...next, tick: (prev?.tick ?? 0) + 1 })),
    [],
  )
  const scope = `doc:${docId}`
  const generating = ask.isPending && messages.at(-1)?.role === 'user'

  const send = () => {
    const prompt = text.trim()
    if (!prompt || ask.isPending || !aiSource) return
    setFocus(null)
    mutate({ prompt, scope })
    setText('')
  }

  /** 실패한 답변을 지우고 마지막 질문을 다시 보낸다. 질문 말풍선은 그대로 둔다. */
  const retry = () => {
    const question = [...messages].reverse().find((m) => m.role === 'user')
    if (!question || ask.isPending) return
    const last = messages.at(-1)
    if (last?.role === 'assistant') store.removeMessage(last.id)
    setFocus(null)
    mutate({ prompt: question.body, scope, resend: true })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        // min-h-0·overflow: 좁은 화면의 낮은 패널에서 이 안내가 제 높이를 고집하면 아래 입력칸을 밀어내 잘린다.
        <p className="text-subtle min-h-0 flex-1 overflow-y-auto px-4 py-6 text-center text-xs leading-relaxed">
          이 문서의 본문을 근거로 답합니다.
          <br />
          필요하면 다른 사내 문서도 찾아 봅니다.
        </p>
      ) : (
        <Conversation
          messages={messages}
          generating={generating}
          status={status}
          streaming={ask.isPending}
          focus={focus}
          onCite={cite}
          onRetry={retry}
          inlineSources
        />
      )}

      {/* 첫 이벤트 전에 실패하면(422·연결 실패) 말풍선이 없다. 사유를 여기 단다.
          서버가 이 문서를 거절했으면(없음·휴지통·근거 꺼짐) 다시 보내도 같아 다시 시도를 두지 않는다. */}
      {ask.isError && messages.at(-1)?.role === 'user' && (
        <p className="text-danger flex flex-wrap items-center justify-center gap-3 px-4 pb-2 text-xs">
          {ask.error.message || '답변을 받지 못했습니다.'}
          {!rejected(ask.error) && (
            <button
              type="button"
              onClick={retry}
              className="text-subtle hover:text-fg cursor-pointer underline underline-offset-2 transition-colors"
            >
              다시 시도
            </button>
          )}
        </p>
      )}

      <div className="border-line shrink-0 border-t p-3">
        {aiSource ? (
          <div className="border-line bg-surface focus-within:border-line-strong rounded-xl border p-2.5 transition-colors">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              submitOnEnter
              onSubmitEnter={send}
              rows={2}
              // 서버 상한(ChatIn.message). `AiComposer` 와 같다.
              maxLength={30000}
              aria-label="이 문서에 대해 AI에게 묻기"
              placeholder="이 문서에 대해 물어보세요"
              className="resize-none border-0 bg-transparent p-0 text-[13px] focus:border-0"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={send} disabled={ask.isPending || text.trim().length === 0}>
                <SendHorizontal className="size-4" />
                보내기
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-subtle text-center text-xs leading-relaxed">
            이 문서는 AI 근거로 쓰기가 꺼져 있어 물어볼 수 없습니다.
            <br />
            상단 줄의 AI 아이콘으로 켤 수 있습니다.
          </p>
        )}
      </div>
    </div>
  )
}
