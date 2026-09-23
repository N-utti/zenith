import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Download, FileText, Paperclip } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { hueOf } from '@/lib/avatar'
import { formatDay, formatRelative, formatTime } from '@/lib/datetime'
import { formatBytes } from '@/lib/format'
import { httpUrl } from '@/lib/serverOrigin'
import { UNTITLED_DOC, useDoc } from '@/features/docs/api'
import { splitMentions } from '@/features/people/mentions'
import { isImage } from './attachments'
import { useMessages } from './api'
import type { ChatAttachment, ChatMessage } from './types'

/** 본문의 `@이름` 을 배지로. 문서 댓글(`CommentPanel`)과 같은 자리를 칠한다. */
function MessageBody({ body }: { body: string }) {
  return splitMentions(body).map((part, i) =>
    part.mention ? (
      <Badge key={i} tone="accent" className="px-1 py-0 text-[length:inherit]">
        {part.text}
      </Badge>
    ) : (
      part.text
    ),
  )
}

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

/**
 * 메시지에 붙은 파일.
 *
 * `url` 은 서버가 준 것을 그대로 쓴다. 내려받기는 쿠키로 인증되고 채널 멤버만 받을 수 있다.
 *
 * 미리보기 판정은 `attachments.ts` 의 `isImage` 가 한다 — 응답의 형식(`content_type`)을
 * 쓰지 않는 이유도 거기 적었다.
 */
function Attachments({ files }: { files: ChatAttachment[] | null }) {
  /** 그리지 못한 이미지. 확장자 판정이 서버와 갈렸거나 못 받아 온 것이다. */
  const [broken, setBroken] = useState<Set<string>>(new Set())
  if (!files || files.length === 0) return null

  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <li key={`${file.url}-${index}`}>
          {isImage(file.name) && !broken.has(file.url) ? (
            <div className="group/image relative w-fit">
              <a href={httpUrl(file.url)} target="_blank" rel="noreferrer" className="block">
                <img
                  src={httpUrl(file.url)}
                  alt={file.name}
                  loading="lazy"
                  // 못 그리면 파일 링크로 떨어뜨린다. 깨진 그림 아이콘만 남으면 이름조차 안 보인다.
                  onError={() => setBroken((prev) => new Set(prev).add(file.url))}
                  className="border-line max-h-60 max-w-full rounded-lg border object-contain"
                />
              </a>
              {/* 이미지는 새 탭으로 열릴 뿐이라 저장할 길이 없었다. 파일 칩과 같은 `download` 를 얹는다.
                  숨어 있을 때는 눌리지도 않는다. 그림을 열려고 누른 것이 내려받기가 되면 안 된다. */}
              <a
                href={httpUrl(file.url)}
                download={file.name}
                aria-label={`${file.name} 내려받기`}
                title="내려받기"
                className="border-line bg-surface text-muted hover:text-fg pointer-events-none absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md border opacity-0 transition-opacity group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100 group-hover/image:pointer-events-auto group-hover/image:opacity-100 max-[1024px]:pointer-events-auto max-[1024px]:opacity-100"
              >
                <Download className="size-3.5" />
              </a>
            </div>
          ) : (
            <a
              href={httpUrl(file.url)}
              download={file.name}
              className="border-line bg-sunken text-muted hover:text-fg flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
            >
              <Paperclip className="size-3.5 shrink-0" />
              <span className="max-w-48 truncate">{file.name}</span>
              <span className="text-subtle">{formatBytes(file.size)}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * 메시지에 실린 문서 카드(05 SCR-04). `doc_ref` 는 문서 id뿐이라 제목·수정 정보는
 * 그 문서를 조회해 채운다. 못 받아 오거나(권한 없음) 휴지통에 있으면 접는다. 상세 조회는
 * 휴지통 문서도 열어 주고, 영구 삭제되면 서버가 `doc_ref` 를 비운다.
 * 한계: 카드 하나에 문서 상세(본문 Yjs 상태 포함)를 통째로 받는다. 무거운 문서가 걸린
 * 채널이 느려지면 백엔드에 메시지 응답에 제목을 실어 달라고 한다(계약 변경).
 */
function DocCard({ docId }: { docId: string }) {
  const { data: doc, isPending, isError } = useDoc(docId)
  // 조회 중에도 카드 높이를 잡아 둔다. 늦게 뜨면 채널을 연 직후 맨 아래가 가려진다.
  if (isPending)
    return <div className="bg-sunken mt-1.5 h-[50px] max-w-xs animate-pulse rounded-lg" />
  if (isError || doc.deleted_at) return null

  return (
    <Link
      to={`/docs/${docId}`}
      className="border-line bg-sunken hover:border-line-strong mt-1.5 flex max-w-xs items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors"
    >
      <FileText className="text-subtle size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-fg truncate text-sm font-medium">{doc.title || UNTITLED_DOC}</p>
        <p className="text-subtle truncate text-xs">
          문서{doc.updated_by && ` · ${doc.updated_by.name}`} · {formatRelative(doc.updated_at)}
        </p>
      </div>
    </Link>
  )
}

export function MessageList({ channelId }: { channelId: string }) {
  const { data, isPending, isError } = useMessages(channelId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const count = data?.items.length ?? 0

  // ⌘K 통합검색은 채팅 결과의 갈 곳을 `/chat/{채널}?m={메시지}` 로 준다. 채널만 열고 말면
  // 찾던 말은 위쪽 어딘가에 묻힌 채로 남는다.
  const [params] = useSearchParams()
  const focusId = params.get('m')
  // 같은 결과를 두 번 고르면 주소가 글자 그대로 같아 `focusId` 가 안 바뀐다. 그 사이 손으로
  // 스크롤해 놓친 줄을 다시 찾아 준다. 라우터는 같은 주소로 밀어도 위치마다 새 열쇠를 준다.
  const { key: visitKey } = useLocation()

  // 새 메시지가 오면 아래로 붙인다. 위를 읽고 있는 중이면 방해하지 않는다.
  useEffect(() => {
    const anchor = bottomRef.current
    const scroller = anchor?.parentElement?.parentElement
    if (!anchor || !scroller) return

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 200) anchor.scrollIntoView({ block: 'end' })
  }, [count, channelId])

  // 찾아온 메시지로 내려 주고 잠깐 밝힌다. 아래 붙이기보다 뒤에 둬야 한다: 같은 로딩에
  // 둘 다 돌면 나중에 부른 쪽이 자리를 정하고, 위로 올라간 뒤에는 아래 붙이기가 200px
  // 조건에 걸려 스스로 비킨다.
  //
  // 목록에 그 메시지가 실린 뒤에 한 번만 움직인다(`found`). 응답 전에는 붙을 자리가 없고,
  // 새 메시지가 올 때마다 다시 튀면 읽던 자리를 뺏는다. 최근 몇 건만 내려오는 목록이라
  // 오래된 메시지는 `found` 가 끝내 거짓이고, 그때는 채널만 열린다(종전 동작).
  //
  // 포커스도 같이 옮긴다. 밝히는 것은 눈으로만 읽히는 신호라, 화면낭독기는 아무것도 못 듣고
  // 키보드는 탭 순서가 ⌘K 를 눌렀던 자리에 남아 다음 탭이 화면 밖으로 튄다. 자리 이동은
  // `scrollIntoView` 에 맡기고(`preventScroll`), 전역 스타일이 외곽선을 `:focus-visible` 에만
  // 걸어 두어 프로그램이 옮긴 포커스에는 테가 생기지 않는다.
  const found = data?.items.some((message) => message.id === focusId) ?? false
  useEffect(() => {
    if (!focusId || !found) return
    const target = document.getElementById(`m-${focusId}`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'center' })
  }, [focusId, found, visitKey])

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

              <div
                id={`m-${message.id}`}
                tabIndex={-1}
                className={cnRow(compact, message.id === focusId)}
              >
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
                      <MessageBody body={message.body} />
                    </p>
                  )}
                  <Attachments files={message.attachments} />
                  {message.doc_ref && <DocCard docId={message.doc_ref} />}
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

// 가로 여백은 밝힐 때만 주면 글줄이 옆으로 밀린다. 항상 물려 두고 색만 오간다.
function cnRow(compact: boolean, flash: boolean) {
  const spacing = compact ? 'mt-0.5' : 'mt-4'
  return `group -mx-2 flex gap-3 rounded-lg px-2 ${spacing} ${flash ? 'animate-flash' : ''}`
}
