import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/ToastContext'
import { AiComposer } from '@/features/ai/AiComposer'
import { AiHistoryPanel } from '@/features/ai/AiHistoryPanel'
import { Conversation } from '@/features/ai/Conversation'
import { SourcesPanel } from '@/features/ai/SourcesPanel'
import { aiSessionsKey, restoreThread, useAiModels, useAsk } from '@/features/ai/api'
import { dropOnRetry, rejected } from '@/features/ai/scope'
import type { AskState, CitationFocus } from '@/features/ai/types'
import { patchMessage, removeMessage, resetThread, switchTo, useThread } from '@/features/ai/store'
import { docKeys } from '@/features/docs/api'
import { ApiError } from '@/lib/api'

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
  const { sessionId, messages, status, busy, epoch } = useThread()
  const ask = useAsk()
  const toast = useToast()
  const qc = useQueryClient()
  // 컴포저를 채울 글과 리마운트 열쇠. 같은 글을 두 번 채워도 열쇠(횟수)가 바뀌어 리마운트된다.
  const [seed, setSeed] = useState({ text: '', n: 0 })
  const fill = (text: string) => setSeed((s) => ({ text, n: s.n + 1 }))
  // 눌린 각주. 새 질문을 보내면 지운다. 근거 패널이 예전 답변에 머물지 않게.
  const [focus, setFocus] = useState<CitationFocus | null>(null)
  // 붙잡아 둔다. 지난 답변 말풍선은 받은 값이 그대로면 다시 그리지 않는데(`Conversation` 의
  // `Answer`), 이 함수가 렌더마다 새로 만들어지면 답변 조각 하나에 전부 다시 그려진다.
  const cite = useCallback(
    (next: Omit<CitationFocus, 'tick'>) =>
      setFocus((prev) => ({ ...next, tick: (prev?.tick ?? 0) + 1 })),
    [],
  )

  // 팔레트에서 넘어온 검색어를 한 번만 컴포저에 채운다. 이미 /ai 에 있을 때 또 넘어와도
  // location.key 가 바뀌므로 다시 채워진다(이전 렌더 기억 패턴, effect 아님).
  const location = useLocation()
  const asked = (location.state as AskState | null)?.ask
  const [askedKey, setAskedKey] = useState<string | null>(null)
  if (asked && location.key !== askedKey) {
    setAskedKey(location.key)
    fill(asked)
  }

  // 새로고침 뒤나 목록에서 다른 대화를 고르면 서버에서 되읽는다. 화면을 떠났다 온 것이면 대화가 이미 있다.
  // 답을 만드는 중이었으면 이어 받는다. 실패하면 서버에 남은 대로 그려 두고 알린다.
  // 앞 대화에서 난 요청 실패(입력창 위 사유·다시 시도)도 이 대화의 것이 아니라 비운다.
  useEffect(() => {
    ask.reset()
    if (messages.length > 0) return
    restoreThread()
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : '대화를 불러오지 못했습니다.'),
      )
      // 이어 받아 끝났으면 목록의 "답변 만드는 중" 을 걷는다.
      .finally(() => void qc.invalidateQueries({ queryKey: aiSessionsKey }))
    // 대화를 옮길 때만. 메시지가 쌓일 때마다 되읽지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

  // 질문은 붙었는데 첫 토큰이 아직 안 왔을 때만 "생성 중" 을 보여준다. 그 뒤로는 말풍선이 자란다.
  // 요청 상태(`ask.isPending`)가 아니라 스토어를 본다. 화면을 떠났다 오거나 되읽어 이어 받는 중에도 맞아야 한다.
  const generating = busy && messages.at(-1)?.role === 'user'

  // 범위로 고른 폴더나 참고 문서를 서버가 거절하면(422, 백엔드 #372·#394) 트리가 낡은 것이다. 다시 받으면
  // 입력창이 그 폴더·문서를 잃는다(지식 소스는 전체로, 칩은 빠짐. `AiComposer`).
  // 첨부를 거절하면(백엔드 #396, 7일 지나 지워짐) 트리와 무관하다. 입력창의 첨부 칩을 비운다.
  const [dropAttachments, setDropAttachments] = useState(0)
  const send = (vars: Parameters<typeof ask.mutate>[0]) =>
    ask.mutate(vars, {
      onError: (error) => {
        const drop = dropOnRetry(vars.scope, vars.docs ?? [], error, vars.attachments)
        if (drop === 'attachments') setDropAttachments((n) => n + 1)
        else if ((vars.scope || vars.docs?.length) && rejected(error))
          void qc.invalidateQueries({ queryKey: docKeys.tree })
      },
    })

  /**
   * 실패한 답변을 지우고 같은 질문·범위로 다시 받는다. 내 질문 말풍선은 그대로 둔다.
   * 질문은 요청 인자가 아니라 스레드에서 찾는다. 스레드는 화면을 떠나도 남지만 요청 인자는 리마운트에 사라진다.
   * 서버가 그 범위를 거절했으면 같은 범위로는 몇 번을 물어도 422 라, 질문의 범위를 전체로 되돌려 묻는다.
   * 참고 문서를 거절했으면(없음·휴지통·근거 꺼짐) 참고 문서를 빼고 묻는다. 첨부(7일 지나 지워짐)도 같다.
   * 셋은 거절 문구로만 갈린다.
   */
  const retry = () => {
    if (busy) return
    const last = messages.at(-1)
    const question = [...messages].reverse().find((m) => m.role === 'user')
    if (!question) return
    setFocus(null)
    if (last?.role === 'assistant') removeMessage(last.id)
    let scope = question.scope ?? null
    let docs = question.docs ?? []
    let attachments = question.attachments ?? []
    const drop = dropOnRetry(scope, docs, ask.error, attachments)
    if (drop === 'attachments') {
      attachments = []
      patchMessage(question.id, { attachments })
      toast.info('쓸 수 없는 첨부가 있어 첨부 없이 다시 찾습니다.')
    } else if (drop === 'scope') {
      scope = null
      patchMessage(question.id, { scope })
      toast.info('고른 폴더를 찾을 수 없어 전체에서 다시 찾습니다.')
    } else if (drop === 'docs') {
      docs = []
      patchMessage(question.id, { docs })
      toast.info('쓸 수 없는 참고 문서가 있어 참고 문서 없이 다시 찾습니다.')
    }
    send({ prompt: question.body, scope, docs, attachments, resend: true })
  }

  return (
    <div className="flex h-full">
      <AiHistoryPanel
        current={sessionId}
        onPick={(id) => {
          setFocus(null)
          switchTo(id)
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface flex h-13 shrink-0 items-center gap-2.5 border-b px-5 py-2.5">
          <h1 className="text-fg shrink-0 text-[15.5px] font-bold whitespace-nowrap">
            AI 어시스턴트
          </h1>
          <span className="text-subtle hidden min-w-0 truncate text-xs sm:inline">
            사내 문서·게시글 기반 답변
          </span>
          <ProviderBadge />
          {/* 서버에 지우는 경로가 없다. 앞 대화는 지워지지 않고 좌패널 목록에 남는다. 받던 답변도 서버가 끝까지 만든다. */}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetThread()
                setFocus(null)
              }}
              aria-label="새 대화"
              // 폰에서는 오른쪽으로 미는 공급자 표시가 숨는다. 그때는 이 버튼이 스스로 오른쪽 끝으로 간다.
              className="ml-auto shrink-0 px-2 sm:ml-2"
              title="새 대화"
            >
              <SquarePen className="size-4" />
            </Button>
          )}
        </header>

        <Conversation
          messages={messages}
          generating={generating}
          status={status}
          streaming={busy}
          focus={focus}
          onCite={cite}
          onRetry={retry}
        />

        {/* 첫 이벤트 전에 실패하면(HTTP 오류·연결 실패) 말풍선이 없다. 그때만 여기서 사유와 재시도를 보인다. 말풍선이 있으면 거기에 붙는다. */}
        {ask.isError && messages.at(-1)?.role === 'user' && (
          <p className="text-danger flex items-center justify-center gap-3 px-5 pb-2 text-xs">
            {ask.error instanceof ApiError && ask.error.code === 'AI_BUSY'
              ? '앞 답변을 아직 만드는 중입니다. 끝난 뒤에 다시 보내 주세요.'
              : ask.error.message || '답변을 받지 못했습니다.'}
            <button
              type="button"
              onClick={retry}
              disabled={busy}
              className="text-subtle hover:text-fg cursor-pointer underline underline-offset-2 transition-colors"
            >
              다시 시도
            </button>
          </p>
        )}

        <AiComposer
          key={seed.n}
          models={models ?? []}
          initialText={seed.text}
          disabled={busy}
          dropAttachments={dropAttachments}
          onSend={(prompt, scope, docs, attachments) => {
            setFocus(null)
            send({ prompt, scope, docs, attachments })
          }}
        />
      </div>

      <SourcesPanel messages={messages} focus={focus} />
    </div>
  )
}
