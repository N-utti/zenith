import { useEffect, useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { formatDay, formatTime } from '@/lib/datetime'
import { useMessages } from './api'
import type { ChatMessage } from './types'

/** 같은 사람이 5분 안에 이어서 보낸 메시지는 아바타·이름을 반복하지 않는다. */
const GROUP_WINDOW_MS = 5 * 60_000

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function grouped(message: ChatMessage, previous: ChatMessage | undefined) {
  if (!previous) return false
  if (previous.authorId !== message.authorId) return false
  if (!sameDay(previous.createdAt, message.createdAt)) return false
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUP_WINDOW_MS
  )
}

export function MessageList({ channelId }: { channelId: string }) {
  const { data, isPending, isError } = useMessages(channelId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const count = data?.items.length ?? 0

  // 새 메시지가 오면 아래로 붙인다. 위를 읽고 있는 중이면 방해하지 않는다.
  useEffect(() => {
    const anchor = bottomRef.current
    const scroller = anchor?.parentElement?.parentElement
    if (!anchor || !scroller) return

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 200) anchor.scrollIntoView({ block: 'end' })
  }, [count, channelId])

  if (isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="grid flex-1 place-items-center">
        <p className="text-subtle text-sm">메시지를 불러오지 못했습니다.</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {data.items.length === 0 && (
          <p className="text-subtle py-12 text-center text-sm">
            아직 메시지가 없습니다. 첫 마디를 남겨 보세요.
          </p>
        )}

        {data.items.map((message, index) => {
          const previous = data.items[index - 1]
          const newDay = !previous || !sameDay(previous.createdAt, message.createdAt)
          const compact = grouped(message, previous)

          return (
            <div key={message.id}>
              {newDay && (
                <div className="my-5 flex items-center gap-3">
                  <span className="bg-line h-px flex-1" />
                  <span className="text-subtle text-xs">{formatDay(message.createdAt)}</span>
                  <span className="bg-line h-px flex-1" />
                </div>
              )}

              <div className={cnRow(compact)}>
                {compact ? (
                  <span className="text-subtle w-9 shrink-0 pt-0.5 text-right text-[11px] opacity-0 group-hover:opacity-100">
                    {formatTime(message.createdAt)}
                  </span>
                ) : (
                  <Avatar name={message.authorName} hue={message.authorHue} size="md" />
                )}

                <div className="min-w-0 flex-1">
                  {!compact && (
                    <p className="text-fg text-sm font-semibold">
                      {message.authorName}
                      <span className="text-subtle ml-1.5 text-xs font-normal">
                        {formatTime(message.createdAt)}
                      </span>
                    </p>
                  )}
                  <p className="text-muted text-sm break-words whitespace-pre-wrap">
                    {message.body}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function cnRow(compact: boolean) {
  return `group flex gap-3 ${compact ? 'mt-0.5' : 'mt-4'}`
}
