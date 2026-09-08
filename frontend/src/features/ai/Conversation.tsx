import { Fragment, useEffect, useRef } from 'react'
import { Check, Copy, FilePlus2, Sparkles, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/ui/ToastContext'
import { useFeedback } from './api'
import { ExcludedNote, SourceCard } from './SourcesPanel'
import type { AiMessage } from './types'

/** 본문의 `[[1]]` 표식을 각주 배지로 바꾼다. */
function withCitations(body: string) {
  return body.split(/(\[\[\d+\]\])/g).map((part, i) => {
    const match = /^\[\[(\d+)\]\]$/.exec(part)
    if (!match) return <Fragment key={i}>{part}</Fragment>
    return (
      <sup
        key={i}
        className="bg-sunken text-muted ml-0.5 rounded px-1 py-0.5 text-[11px] font-bold"
      >
        {match[1]}
      </sup>
    )
  })
}

function AnswerActions({ id, body }: { id: string; body: string }) {
  const [copied, setCopied] = useState(false)
  const [helpful, setHelpful] = useState(false)
  const feedback = useFeedback()
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

  const copy = async () => {
    await navigator.clipboard.writeText(body.replace(/\[\[\d+\]\]/g, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
        className={cn(item, 'active:text-accent', helpful && 'text-accent hover:text-accent disabled:opacity-100')}
      >
        <ThumbsUp className={cn('size-3.5', helpful && 'fill-current')} />
        도움돼요
      </button>
      <button type="button" onClick={() => void copy()} className={item}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? '복사됨' : '복사'}
      </button>
      <button type="button" className={item} title="M3에서 문서 저장까지 연결됩니다">
        <FilePlus2 className="size-3.5" />
        문서로 저장
      </button>
    </div>
  )
}

function Generating() {
  return (
    <div className="flex gap-3">
      <span className="bg-accent-soft text-accent grid size-8 shrink-0 place-items-center rounded-lg">
        <Sparkles className="size-4" />
      </span>
      <div className="flex items-center gap-2 pt-1.5">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="bg-subtle size-1.5 animate-bounce rounded-full"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
        <span className="text-subtle text-xs">AI가 생성 중…</span>
      </div>
    </div>
  )
}

export function Conversation({
  messages,
  generating,
  streaming,
}: {
  messages: AiMessage[]
  /** 질문은 갔는데 첫 토큰이 아직 안 왔다. */
  generating: boolean
  /** 답변이 자라는 중. 마지막 말풍선의 액션은 다 받은 뒤에 보인다. */
  streaming: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)

  // 스트리밍은 메시지를 추가하지 않고 마지막 본문만 늘린다. 그 길이도 따라간다.
  const lastLength = messages.at(-1)?.body.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastLength, generating])

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex justify-end">
              <p className="bg-accent text-on-accent max-w-[78%] rounded-xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
                {message.body}
              </p>
            </div>
          ) : (
            <div key={message.id} className="flex gap-3">
              <span className="bg-accent-soft text-accent grid size-8 shrink-0 place-items-center rounded-lg">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-fg text-[13px] font-semibold">AI 어시스턴트</p>
                <p className="text-fg mt-1.5 text-sm leading-[1.75]">
                  {withCitations(message.body)}
                </p>
                {message.error && (
                  <p className="text-danger mt-2 text-xs">{message.error}</p>
                )}
                {!message.error && !(streaming && index === messages.length - 1) && (
                  <AnswerActions id={message.id} body={message.body} />
                )}

                {/* lg 미만에는 우측 근거 패널이 없다. 따라갈 수 없는 각주를 남기지 않는다. */}
                {(message.citations?.length ?? 0) > 0 && (
                  <div className="mt-3 lg:hidden">
                    <p className="text-subtle mb-2 text-[11px] font-bold">
                      근거 문서 {message.citations?.length}
                    </p>
                    <ul className="space-y-2">
                      {message.citations?.map((source) => (
                        <li key={source.n}>
                          <SourceCard source={source} />
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      <ExcludedNote />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {generating && <Generating />}
        <div ref={endRef} />
      </div>
    </div>
  )
}
