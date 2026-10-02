import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Download, FileText, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { hueOf } from '@/lib/avatar'
import { formatDay, formatRelative, formatTime } from '@/lib/datetime'
import { formatBytes } from '@/lib/format'
import { httpUrl } from '@/lib/serverOrigin'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { UNTITLED_DOC, useDoc } from '@/features/docs/api'
import { MentionText } from '@/features/people/MentionText'
import { MSW_ENABLED } from '@/mocks/accounts'
import { isImage } from './attachments'
import { MAX_BODY_CHARS, useMessages, useOlderMessages } from './api'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatAttachment, ChatMessage } from './types'

/**
 * 내 메시지 고치기·지우기를 보일지. 실서버의 소켓에는 아직 그 op 이 없다(04 §4.1 에 `msg`·`read`·
 * `typing` 뿐). 개발 릴레이(`scripts/chat.js`)는 받으므로 목이 켜진 개발 화면에서만 보인다.
 * 서버가 받게 되면 이 스위치를 걷는다.
 */
const MESSAGE_EDIT_ENABLED = MSW_ENABLED

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
                className="border-line bg-surface text-muted hover:text-fg pointer-events-none absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md border opacity-0 transition-opacity group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100 group-hover/image:pointer-events-auto group-hover/image:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
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

export function MessageList({
  channelId,
  mentionNames,
}: {
  channelId: string
  /** 줄마다 그대로 넘어간다. 내용이 같으면 같은 객체여야 줄을 건너뛴다(`MessageRow`). */
  mentionNames: ReadonlySet<string>
}) {
  const { data, isPending, isError } = useMessages(channelId)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const count = data?.items.length ?? 0

  // ⌘K 통합검색은 채팅 결과의 갈 곳을 `/chat/{채널}?m={메시지}` 로 준다. 채널만 열고 말면
  // 찾던 말은 위쪽 어딘가에 묻힌 채로 남는다.
  const [params] = useSearchParams()
  const focusId = params.get('m')
  // 같은 결과를 두 번 고르면 주소가 글자 그대로 같아 `focusId` 가 안 바뀐다. 그 사이 손으로
  // 스크롤해 놓친 줄을 다시 찾아 준다. 라우터는 같은 주소로 밀어도 위치마다 새 열쇠를 준다.
  const { key: visitKey } = useLocation()

  // 새 메시지가 오면 아래로 붙인다. 남의 메시지는 위를 읽고 있는 중이면 방해하지 않는다.
  // 채널을 처음 그릴 때와 내가 보낸 메시지는 조건 없이 내린다(이슈 #207). 첫 그림은 맨 위에서
  // 시작해 200px 조건을 넘지 못하고, 내 메시지가 화면 밖에 남으면 보냈는지 알 수 없다.
  // 내 메시지는 마지막 id 가 새로 바뀐 때만 본다. 목록을 다시 받아 건수만 줄어든 때(창 복귀,
  // 소켓 재연결)에 끌어내리면 위를 읽던 자리를 뺏는다.
  const me = useCurrentUser().id
  const last = data?.items.at(-1)
  const lastId = last?.id
  const lastMine = last?.author.id === me
  const settledChannel = useRef<string | null>(null)
  const seenLast = useRef<string | undefined>(undefined)
  const seenCount = useRef(0)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    // 건수가 늘었을 때만 「내가 방금 보냈다」로 본다. 내 마지막 메시지가 지워져 그 앞의 내
    // 메시지가 마지막이 된 것도 id 가 바뀌지만, 그때 끌어내리면 위를 읽던 자리를 뺏는다.
    const sentByMe = lastMine && lastId !== seenLast.current && count > seenCount.current
    seenLast.current = lastId
    seenCount.current = count
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (settledChannel.current !== channelId || sentByMe || distanceFromBottom < 200) {
      settledChannel.current = channelId
      // 스크롤 영역을 끝까지 내린다. 마지막 줄에 맞추면 목록 아래 여백만큼 덜 내려가 바닥이 남는다.
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [count, channelId, lastId, lastMine])

  // 더 과거를 앞에 붙이면 읽던 줄이 그만큼 아래로 밀린다. 누르는 순간 바닥에서 얼마나 떨어져
  // 있었는지 적어 두고, 붙은 뒤 같은 거리로 되돌린다. 위에서부터 재면 브라우저가 스스로 자리를
  // 잡아 주는 경우(크롬)와 겹쳐 두 번 밀린다. 바닥부터 재면 어느 쪽이든 같은 자리가 나온다.
  //
  // 되돌리는 때는 「첫 메시지가 바뀌었을 때」가 아니라 「받기가 끝났을 때」다. 첫 메시지는 목록을
  // 다시 받아도 바뀌는데, 그때 적어 둔 거리를 써 버리면 정작 과거가 붙을 때는 남은 것이 없다.
  // 받은 쪽을 버린 경우(`prependOlder`)에는 같은 자리로 맞추는 것이라 아무 일도 없다.
  // 찾아온 메시지(`?m=`)가 붙인 쪽에 들어 있으면 아래 효과가 뒤이어 그 줄로 데려간다.
  const older = useOlderMessages(channelId)
  const keepFromBottom = useRef<number | null>(null)
  const [loadedOlder, setLoadedOlder] = useState(0)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || keepFromBottom.current === null) return
    scroller.scrollTop = scroller.scrollHeight - keepFromBottom.current
    keepFromBottom.current = null
  }, [loadedOlder])
  const loadOlder = (cursor: string) => {
    const scroller = scrollerRef.current
    if (scroller) keepFromBottom.current = scroller.scrollHeight - scroller.scrollTop
    older.mutate(cursor, {
      onSuccess: () => setLoadedOlder((n) => n + 1),
      // 못 받았으면 되돌릴 것도 없다. 남겨 두면 다음에 받을 때 엉뚱한 자리로 간다.
      onError: () => (keepFromBottom.current = null),
    })
  }

  // 내 메시지 고치기·지우기. 소켓으로 보내고 화면은 돌아오는 이벤트로 바뀐다(`useChatSocket`).
  // 닫혀 있으면 보내지 못한다. 줄에는 고칠 입력 옆 자리가 없어 토스트로 알린다.
  // 두 함수는 줄마다 그대로 넘어가므로 그릴 때마다 같아야 한다(`MessageRow` 의 memo).
  const { editMessage, deleteMessage } = useChatSocketContext()
  const toast = useToast()
  const edit = useCallback(
    (messageId: string, body: string) => {
      const sent = editMessage(channelId, messageId, body)
      if (!sent) toast.error('연결이 끊겨 고치지 못했습니다. 연결되면 다시 시도하세요.')
      return sent
    },
    [editMessage, channelId, toast],
  )
  const remove = useCallback(
    (messageId: string) => {
      const sent = deleteMessage(channelId, messageId)
      if (!sent) toast.error('연결이 끊겨 지우지 못했습니다. 연결되면 다시 시도하세요.')
      return sent
    },
    [deleteMessage, channelId, toast],
  )

  // 찾아온 메시지로 내려 주고 잠깐 밝힌다. 아래 붙이기보다 뒤에 둬야 한다: 같은 로딩에
  // 둘 다 돌면 나중에 부른 쪽이 자리를 정하고, 위로 올라간 뒤에는 아래 붙이기가 200px
  // 조건에 걸려 스스로 비킨다(내가 새로 보낸 메시지만 예외).
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
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {data.items.length === 0 && (
          <p className="text-subtle py-12 text-center text-sm">
            아직 메시지가 없습니다. 첫 마디를 남겨 보세요.
          </p>
        )}

        {data.next_cursor && (
          <div className="mb-2 flex flex-col items-center gap-1">
            <button
              type="button"
              disabled={older.isPending}
              onClick={() => data.next_cursor && loadOlder(data.next_cursor)}
              className="border-line text-muted hover:bg-surface-hover hover:text-fg flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-xs transition-colors disabled:cursor-default disabled:opacity-60"
            >
              {older.isPending && <Spinner />}
              이전 메시지 더 보기
            </button>
            {older.isError && (
              <p role="alert" className="text-danger text-xs">
                이전 메시지를 불러오지 못했습니다.
              </p>
            )}
          </div>
        )}

        {data.items.map((message, index) => {
          const previous = data.items[index - 1]

          const newDay = !previous || !sameDay(previous.created_at, message.created_at)

          return (
            <MessageRow
              key={message.id}
              message={message}
              dayLabel={newDay ? formatDay(message.created_at) : null}
              compact={grouped(message, previous)}
              flash={message.id === focusId}
              mentionNames={mentionNames}
              onEdit={MESSAGE_EDIT_ENABLED && message.author.id === me ? edit : undefined}
              onDelete={MESSAGE_EDIT_ENABLED && message.author.id === me ? remove : undefined}
            >
              {message.doc_ref && <DocCard docId={message.doc_ref} />}
            </MessageRow>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 메시지 한 줄. `memo` 라 받은 값이 그대로면 다시 그리지 않는다.
 *
 * 목록은 이 방에 글이 올 때만이 아니라 채널 목록이 바뀔 때마다(어느 방이든 새 글·안읽음 숫자)
 * `ChatPage` 를 따라 다시 돈다. 줄을 나눠 두지 않으면 그때마다 쌓인 줄 전부를 다시 그리고,
 * 목록은 받는 대로 늘기만 해서(다시 받기 전까지) 탭을 오래 켜 둘수록 느려진다. 개발 빌드로
 * 300줄에서 한 번에 0.1초가 넘게 걸렸다.
 *
 * 그래서 넘기는 값은 내용이 바뀔 때만 바뀌어야 한다. `message` 는 캐시가 든 객체 그대로 오고
 * (`appendMessage`), `mentionNames` 는 `ChatPage` 가 내용으로 붙잡는다.
 *
 * 그릴 때마다 달라지는 것은 줄 안에서 계산하지 않고 받는다. 안에서 하면 건너뛴 줄에 낡은 값이
 * 남는다. 날짜 줄의 「오늘·어제」 는 자정을 넘기면 바뀌어야 해서 문구로 받고, 문서 카드의
 * 「12분 전」 은 카드째 `children` 으로 받는다. 카드가 든 줄은 그래서 매번 다시 그려진다.
 */
const MessageRow = memo(function MessageRow({
  message,
  dayLabel,
  compact,
  flash,
  mentionNames,
  onEdit,
  onDelete,
  children,
}: {
  message: ChatMessage
  /** 앞 메시지와 날짜가 다를 때 위에 긋는 날짜 줄의 문구. 같은 날이면 `null`. */
  dayLabel: string | null
  /** 같은 사람이 이어서 보내 아바타·이름을 생략한다. */
  compact: boolean
  /** ⌘K 로 찾아온 메시지라 잠깐 밝힌다. */
  flash: boolean
  mentionNames: ReadonlySet<string>
  /**
   * 내 메시지일 때만 온다. 보냈으면 `true`, 소켓이 닫혀 못 보냈으면 `false`. 줄을 건너뛰게
   * 하려면 그릴 때마다 같은 함수여야 한다(`MessageList` 가 붙잡는다).
   */
  onEdit?: (messageId: string, body: string) => boolean
  onDelete?: (messageId: string) => boolean
  /** 문서 카드. 없는 줄은 `null`. */
  children: ReactNode
}) {
  /** 고치는 중인 글. 고치는 중이 아니면 `null`. */
  const [draft, setDraft] = useState<string | null>(null)
  const row = useRef<HTMLDivElement>(null)

  /** 고치는 칸을 닫는다. 칸이 사라지면 초점이 body 로 떨어지므로 이 줄로 돌려놓는다(버튼도 다시 뜬다). */
  const close = () => {
    setDraft(null)
    row.current?.focus({ preventScroll: true })
  }

  // ponytail: 고치는 사이 다른 탭에서 이 메시지가 지워지면 쓰던 글은 줄과 함께 사라지고,
  // 고쳐졌으면 나중에 저장한 쪽이 남는다. 알리지 않는다.
  const save = () => {
    if (draft === null || !onEdit) return
    const next = draft.trim()
    if (next === message.body) return close()
    // 글을 다 지우면 저장하지 않는다(첨부만 남는 경우는 된다). 메시지를 없애려면 지우기를 쓴다.
    if (!next && !message.attachments?.length) return
    // 화면은 돌아오는 `msg_edit` 로 바뀐다. 못 보냈으면 고치던 글을 그대로 둔다.
    if (onEdit(message.id, next)) close()
  }

  return (
    <div>
      {dayLabel && (
        <div className="my-5 flex items-center gap-3">
          <span className="bg-line h-px flex-1" />
          <span className="text-subtle text-xs">{dayLabel}</span>
          <span className="bg-line h-px flex-1" />
        </div>
      )}

      <div ref={row} id={`m-${message.id}`} tabIndex={-1} className={cnRow(compact, flash)}>
        {/*
          고치기·지우기. 줄 오른쪽 위에 떠서 줄 높이를 바꾸지 않는다. 줄에 올리거나 줄 안에 초점이
          있을 때만 보이고(줄은 누르면 초점을 받는다. 손가락 기기는 메시지를 한 번 누르면 뜬다),
          숨어 있을 때는 눌리지도 않는다.
        */}
        {onEdit && onDelete && draft === null && (
          <div className="border-line bg-surface pointer-events-none absolute -top-3 right-2 flex rounded-md border opacity-0 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
            <button
              type="button"
              aria-label={`${formatTime(message.created_at)} 메시지 고치기`}
              title="고치기"
              onClick={() => setDraft(message.body)}
              className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`${formatTime(message.created_at)} 메시지 지우기`}
              title="지우기"
              onClick={() => {
                if (confirm('이 메시지를 지울까요? 되돌릴 수 없습니다.')) onDelete(message.id)
              }}
              className="text-subtle hover:text-danger grid size-7 cursor-pointer place-items-center rounded"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}

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
          {draft !== null ? (
            <div className="mt-1">
              {/* ponytail: 멘션 자동 완성 없이 글자로만 고친다. 이미 쓴 `@이름` 은 그대로 남는다. */}
              <Textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_BODY_CHARS}
                // 줄바꿈 없이 길게 쓴 글도 한 줄에 갇히지 않게 글자 수로도 어림한다.
                rows={Math.min(8, Math.max(draft.split('\n').length, Math.ceil(draft.length / 50)))}
                aria-label="메시지 고치기"
                className="resize-none"
                submitOnEnter
                onSubmitEnter={save}
                onKeyDown={(e) => {
                  // 한글을 조합하는 중의 Esc 는 조합만 취소한다. 쓰던 글까지 버리지 않는다.
                  if (e.key === 'Escape' && !e.nativeEvent.isComposing) close()
                }}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" onClick={save}>
                  저장
                </Button>
                <Button size="sm" variant="secondary" onClick={close}>
                  취소
                </Button>
                <span className="text-subtle text-xs">Enter 저장 · Esc 취소</span>
              </div>
            </div>
          ) : (
            message.body && (
              <p className="text-muted text-sm break-words whitespace-pre-wrap">
                <MentionText body={message.body} names={mentionNames} />
                {message.edited_at && (
                  <span
                    className="text-subtle ml-1.5 text-[11px]"
                    title={`${formatDay(message.edited_at)} ${formatTime(message.edited_at)} 수정`}
                  >
                    (수정됨)
                  </span>
                )}
              </p>
            )
          )}
          <Attachments files={message.attachments} />
          {children}
        </div>
      </div>
    </div>
  )
})

// 가로 여백은 밝힐 때만 주면 글줄이 옆으로 밀린다. 항상 물려 두고 색만 오간다.
function cnRow(compact: boolean, flash: boolean) {
  const spacing = compact ? 'mt-0.5' : 'mt-4'
  // relative: 고치기·지우기 버튼이 이 줄의 오른쪽 위에 뜬다.
  return `group relative -mx-2 flex gap-3 rounded-lg px-2 ${spacing} ${flash ? 'animate-flash' : ''}`
}
