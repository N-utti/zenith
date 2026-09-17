import { useEffect, useRef } from 'react'
import { Paperclip } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { hueOf } from '@/lib/avatar'
import { formatDay, formatTime } from '@/lib/datetime'
import { httpUrl } from '@/lib/serverOrigin'
import { useMessages } from './api'
import type { ChatAttachment, ChatMessage } from './types'

/** 같은 사람이 5분 안에 이어서 보낸 메시지는 아바타·이름을 반복하지 않는다. */
const GROUP_WINDOW_MS = 5 * 60_000

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function grouped(message: ChatMessage, previous: ChatMessage | undefined) {
  if (!previous) return false
  if (previous.author.id !== message.author.id) return false
  if (!sameDay(previous.created_at, message.created_at)) return false
  return (
    new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() <
    GROUP_WINDOW_MS
  )
}

/** 이미지만 바로 보여 준다. 나머지는 이름·크기만 두고 누르면 내려받는다. */
function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 메시지에 붙은 파일.
 *
 * `url` 은 서버가 준 것을 그대로 쓴다. 내려받기는 쿠키로 인증되고 채널 멤버만 받을 수 있다.
 * 이미지는 서버가 `inline` 으로 내려주는 형식(png·jpeg·gif·webp)만 미리 보여 준다.
 * SVG·HTML 은 같은 오리진에서 스크립트가 돌 수 있어 서버도 내려받기로만 준다.
 */
function Attachments({ files }: { files: ChatAttachment[] | null }) {
  if (!files || files.length === 0) return null

  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.url}>
          {isImage(file.name) ? (
            <a href={httpUrl(file.url)} target="_blank" rel="noreferrer">
              <img
                src={httpUrl(file.url)}
                alt={file.name}
                className="border-line max-h-60 max-w-full rounded-lg border object-contain"
              />
            </a>
          ) : (
            <a
              href={httpUrl(file.url)}
              download={file.name}
              className="border-line bg-sunken text-muted hover:text-fg flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
            >
              <Paperclip className="size-3.5 shrink-0" />
              <span className="max-w-48 truncate">{file.name}</span>
              <span className="text-subtle">{formatSize(file.size)}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
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
          const newDay = !previous || !sameDay(previous.created_at, message.created_at)
          const compact = grouped(message, previous)

          return (
            <div key={message.id}>
              {newDay && (
                <div className="my-5 flex items-center gap-3">
                  <span className="bg-line h-px flex-1" />
                  <span className="text-subtle text-xs">{formatDay(message.created_at)}</span>
                  <span className="bg-line h-px flex-1" />
                </div>
              )}

              <div className={cnRow(compact)}>
                {compact ? (
                  <span className="text-subtle w-9 shrink-0 pt-0.5 text-right text-[11px] opacity-0 group-hover:opacity-100">
                    {formatTime(message.created_at)}
                  </span>
                ) : (
                  <Avatar name={message.author.name} hue={hueOf(message.author.id)} size="md" />
                )}

                <div className="min-w-0 flex-1">
                  {!compact && (
                    <p className="text-fg text-sm font-semibold">
                      {message.author.name}
                      <span className="text-subtle ml-1.5 text-xs font-normal">
                        {formatTime(message.created_at)}
                      </span>
                    </p>
                  )}
                  {message.body && (
                    <p className="text-muted text-sm break-words whitespace-pre-wrap">
                      {message.body}
                    </p>
                  )}
                  <Attachments files={message.attachments} />
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
