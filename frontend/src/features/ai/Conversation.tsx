import { memo, useEffect, useId, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  RefreshCw,
  Sparkles,
  ThumbsUp,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { copyText } from '@/lib/clipboard'
import { useToast } from '@/components/ui/ToastContext'
import { NewDocModal } from '@/features/docs/NewDocModal'
import type { DocSeedState } from '@/features/docs/types'
import { AiMarkdown } from './AiMarkdown'
import { useFeedback } from './api'
import { answerToSeed } from './saveAsDoc'
import { ExcludedNote, SourceCard } from './SourcesPanel'
import type { AiMessage, CitationFocus } from './types'

function AnswerActions({
  id,
  body,
  question,
}: {
  id: string
  body: string
  /** 이 답변을 부른 질문. 문서로 저장할 때 제목이 된다. */
  question: string | undefined
}) {
  const [copied, setCopied] = useState(false)
  const [helpful, setHelpful] = useState(false)
  const feedback = useFeedback()
  /** 고를 폴더 창에 넘길 초안. 누를 때 만든다(`answerToSeed` 는 렌더 중에 못 부른다). */
  const [seed, setSeed] = useState<DocSeedState | null>(null)
  const toast = useToast()

  /** 켤 때만 1 을 보낸다. -1 은 "도움 안 됨" 이지 철회가 아니라, 끄기는 화면 표시만 되돌린다. */
  const toggleHelpful = () => {
    const next = !helpful
    setHelpful(next)
    if (next) {
      feedback.mutate(
        { messageId: id, value: 1 },
        {
          onError: () => {
            setHelpful(false)
            toast.error('평가를 보내지 못했습니다.')
          },
        },
      )
    }
  }

  const copy = () =>
    void copyText(body.replace(/\[\[\d+\]\]/g, '')).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => toast.error('답변을 복사하지 못했습니다.'),
    )

  const item =
    'text-subtle hover:text-fg flex cursor-pointer items-center gap-1.5 transition-colors disabled:cursor-default disabled:opacity-50'

  return (
    <div className="mt-3 flex gap-4 text-[11.5px]">
      <button
        type="button"
        onClick={toggleHelpful}
        disabled={feedback.isPending}
        aria-pressed={helpful}
        // 누르는 순간(active)부터 파랗고, 눌린 상태는 호버·전송 중 반투명보다 우선한다.
        className={cn(
          item,
          'active:text-accent',
          helpful && 'text-accent hover:text-accent disabled:opacity-100',
        )}
      >
        <ThumbsUp className={cn('size-3.5', helpful && 'fill-current')} />
        도움돼요
      </button>
      <button type="button" onClick={copy} className={item}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? '복사됨' : '복사'}
      </button>
      <button type="button" onClick={() => setSeed(answerToSeed(body, question))} className={item}>
        <FilePlus2 className="size-3.5" />
        문서로 저장
      </button>
      {seed && <NewDocModal title="문서로 저장" seed={seed} onClose={() => setSeed(null)} />}
    </div>
  )
}

function Generating({ status }: { status: string | null }) {
  return (
    <div className="flex gap-3">
      <span className="bg-accent-soft text-accent grid size-8 shrink-0 place-items-center rounded-lg">
        <Sparkles className="size-4" />
      </span>
      <div className="flex items-center gap-2">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="bg-subtle size-1.5 animate-bounce rounded-full"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
        <span className="text-subtle text-xs">{status ? `${status}…` : 'AI가 생성 중…'}</span>
      </div>
    </div>
  )
}

export function Conversation({
  messages,
  generating,
  status,
  streaming,
  focus,
  onCite,
  onRetry,
  inlineSources = false,
}: {
  messages: AiMessage[]
  /** 질문은 갔는데 첫 토큰이 아직 안 왔다. */
  generating: boolean
  /** 그동안 서버가 알려 준 진행 상황. 없으면 기본 문구. */
  status: string | null
  /** 답변이 자라는 중. 마지막 말풍선의 액션은 다 받은 뒤에 보인다. */
  streaming: boolean
  /** 눌린 각주. 같은 답변의 같은 번호만 켜진다. */
  focus: CitationFocus | null
  onCite: (focus: Omit<CitationFocus, 'tick'>) => void
  /** 마지막 답변이 실패했을 때 같은 질문을 다시 보낸다(05 공통 규칙 "생성 실패, 다시 시도"). */
  onRetry: () => void
  /** 근거 목록을 화면 폭과 상관없이 답변 아래에 둔다(기본은 접힘). 옆에 근거 패널이 없는 곳(문서 질문창)에서 켠다. */
  inlineSources?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  // 스트리밍은 메시지를 추가하지 않고 마지막 본문만 늘린다. 그 길이도 따라간다.
  // 다 받은 뒤에는 마지막 답변 아래에 액션 줄이 생겨 한 번 더 는다(`streaming`).
  const lastLength = messages.at(-1)?.body.length ?? 0
  useEffect(() => {
    // 스크롤 영역을 끝까지 내린다. 마지막 줄에 맞추면 아래 여백만큼 덜 내려가 바닥이 남는다.
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messages.length, lastLength, generating, streaming, status])

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.map((message, index) => {
          if (message.role === 'user') {
            return (
              <div key={message.id} className="flex justify-end">
                <p className="bg-accent text-on-accent max-w-[78%] rounded-xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
                  {message.body}
                </p>
              </div>
            )
          }
          const last = index === messages.length - 1
          const focused = focus?.messageId === message.id ? focus : null
          return (
            <Answer
              key={message.id}
              message={message}
              question={messages[index - 1]?.role === 'user' ? messages[index - 1].body : undefined}
              focusN={focused?.n ?? null}
              focusTick={focused?.tick}
              growing={streaming && last}
              onCite={onCite}
              onRetry={last ? onRetry : undefined}
              inlineSources={inlineSources}
            />
          )
        })}

        {/* 말풍선이 자라다 멈추고 서버가 다시 문서를 찾는 동안에도 같은 표시를 말풍선 아래에 둔다. */}
        {(generating || (streaming && status)) && <Generating status={status} />}
      </div>
    </div>
  )
}

/**
 * 답변 말풍선 하나. `memo` 라 받은 값이 그대로면 다시 그리지 않는다.
 *
 * 답변은 조각이 올 때마다 스레드가 새 객체가 되어 화면 전체가 다시 돈다. 말풍선을 나눠 두지
 * 않으면 조각 하나에 지난 답변 전부(각주·근거 카드·액션)를 다시 그려, 대화가 길수록 느려진다.
 *
 * 그래서 넘기는 값은 이 답변의 것이 바뀔 때만 바뀌어야 한다. `message` 는 자라는 답변만 새
 * 객체가 되고(`patchMessage`), 눌린 각주는 이 답변의 것만 번호와 일련번호로 받는다.
 * `onCite` 는 `AiPage` 가 붙잡아 두고, `onRetry` 는 마지막 답변에만 준다.
 */
const Answer = memo(function Answer({
  message,
  question,
  focusN,
  focusTick,
  growing,
  onCite,
  onRetry,
  inlineSources,
}: {
  message: AiMessage
  /** 이 답변을 부른 질문. 문서로 저장할 때 제목이 된다. */
  question: string | undefined
  /** 이 답변에서 눌린 각주 번호. 눌린 각주가 없거나 다른 답변의 것이면 `null`. */
  focusN: number | null
  /** 그 각주의 클릭 일련번호(`CitationFocus.tick`). */
  focusTick: number | undefined
  /** 아직 자라는 중. 액션은 다 받은 뒤에 보인다. */
  growing: boolean
  onCite: (focus: Omit<CitationFocus, 'tick'>) => void
  /** 마지막 답변에만 온다. 실패했을 때 같은 질문을 다시 보낸다. */
  onRetry: (() => void) | undefined
  inlineSources: boolean
}) {
  // 답변 아래 근거 목록은 접어 둔다. 본문보다 길어 대화를 밀어낸다.
  // 이 답변의 각주를 누르면(일련번호가 바뀌면) 펼친다. 렌더 중에 맞춰야 카드가 같은 커밋에 보인다.
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [seenTick, setSeenTick] = useState(focusTick)
  if (focusTick !== seenTick) {
    setSeenTick(focusTick)
    if (focusTick !== undefined) setSourcesOpen(true)
  }
  const sourcesId = useId()

  return (
    <div className="flex gap-3">
      <span className="bg-accent-soft text-accent grid size-8 shrink-0 place-items-center rounded-lg">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-fg text-[13px] font-semibold">AI 어시스턴트</p>
        <AiMarkdown
          text={message.body}
          className="mt-1.5 text-sm leading-[1.75]"
          cite={{
            has: (n) => message.citations?.some((c) => c.n === n) ?? false,
            activeN: focusN,
            onCite: (n) => onCite({ messageId: message.id, n }),
          }}
        />
        {message.error && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <p className="text-danger">{message.error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-subtle hover:text-fg flex cursor-pointer items-center gap-1 transition-colors"
              >
                <RefreshCw className="size-3" />
                다시 시도
              </button>
            )}
          </div>
        )}
        {!message.error && !growing && (
          <AnswerActions
            id={message.serverId ?? message.id}
            body={message.body}
            question={question}
          />
        )}

        {/* lg 미만에는 우측 근거 패널이 없다. 따라갈 수 없는 각주를 남기지 않는다. */}
        {(message.citations?.length ?? 0) > 0 && (
          <div className={cn('mt-3', !inlineSources && 'lg:hidden')}>
            <button
              type="button"
              onClick={() => setSourcesOpen((v) => !v)}
              aria-expanded={sourcesOpen}
              aria-controls={sourcesId}
              className="text-subtle hover:text-fg flex cursor-pointer items-center gap-1 text-[11px] font-bold transition-colors"
            >
              {sourcesOpen ? (
                <ChevronDown className="size-3.5" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden />
              )}
              근거 {message.citations?.length}
            </button>
            {/* 접혀도 카드는 그려 둔다. 각주를 누른 그 커밋에 보이게 바꿔야 카드가 스크롤·초점을 받는다. */}
            <div id={sourcesId} hidden={!sourcesOpen} className="mt-2">
              <ul className="space-y-2">
                {message.citations?.map((source) => (
                  <li key={source.n}>
                    <SourceCard
                      source={source}
                      activeTick={focusN === source.n ? focusTick : undefined}
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <ExcludedNote />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
