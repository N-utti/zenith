import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { markOnboarding } from '@/features/home/onboarding'
import { MentionTextarea } from '@/features/people/MentionTextarea'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY_CHARS, uploadAttachment } from './api'
import { isImage, reorder } from './attachments'
import { isAiCommand } from './aiCommand'
import { useChatSocketContext } from './ChatSocketContext'
import { getDraft, setDraft } from './drafts'
import type { ChatAttachment, Person } from './types'

/** 끊겨서 못 보냈다는 문구. 다시 연결되면 이 문구만 지운다. */
const DISCONNECTED = '연결이 끊겨 보내지 못했습니다. 연결되면 다시 시도하세요.'

export function Composer({
  channelId,
  channelName,
  hash,
  mentionCandidates,
  onTyping,
}: {
  channelId: string
  channelName: string
  /** 공개 채널은 이름 앞에 `#` 을 붙인다(채널 목록·헤더와 같은 표기). DM·비공개 채널은 안 붙인다. */
  hash: boolean
  /** @ 자동완성 후보(DM 은 상대만, 채널은 멤버 전원). */
  mentionCandidates: Person[]
  onTyping: () => void
}) {
  const { connected, sendMessage } = useChatSocketContext()
  // 다른 방에 다녀와도 쓰던 글이 남는다(`drafts`). 첨부는 남기지 않는다.
  const [body, setBody] = useState(() => getDraft(channelId))
  /** 올려 둔 파일. 보내기 전까지는 서버에만 있고 어느 메시지에도 안 붙어 있다. */
  const [files, setFiles] = useState<ChatAttachment[]>([])
  /** 올라가는 중인 개수. 개수 상한은 이것까지 세야 한다. */
  const [uploading, setUploading] = useState(0)
  /**
   * 사진 미리보기. 첨부 주소(`url`)마다 고른 파일 자체를 data 주소로 읽어 둔다. 서버 주소로는 못
   * 그린다. 서버는 메시지에 실린 파일만 내주고 아직 안 보낸 파일은 404 다(백엔드 #324). blob 주소도
   * 못 쓴다. 운영 서버의 보안 정책이 그림 출처를 자기 자신과 data 로만 연다(`infra/caddy/Caddyfile`).
   * ponytail: 원본을 통째로 읽어 10MB 사진 열 장이면 백수십 MB 를 문자열로 든다. 무거워지면
   * canvas 로 줄여서 든다.
   */
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  /**
   * 끊겨서 못 보낸 적이 있는지. 문구를 상태에 담지 않고 이 깃발과 `connected` 로 만든다.
   * 담아 두면 다시 연결된 뒤에도 지울 곳이 없어 빨간 문구가 남는다.
   */
  const [triedOffline, setTriedOffline] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  /** 입력칸 위에 덮어 그리는 `/ai` 칩 층. 입력칸이 스크롤되면 같이 올린다. */
  const chipLayer = useRef<HTMLDivElement>(null)

  const pick = async (list: FileList | null) => {
    setError(null)
    const chosen = [...(list ?? [])]
    if (chosen.length === 0) return
    // 올라가는 중인 것도 센다. 안 그러면 두 번에 나눠 고를 때 상한을 넘긴다.
    if (files.length + uploading + chosen.length > MAX_ATTACHMENTS) {
      return setError(`파일은 ${MAX_ATTACHMENTS}개까지 붙일 수 있습니다.`)
    }
    // 상한은 서버가 강제하지만 여기서 먼저 걸러야 10MB 를 올렸다가 422 를 보지 않는다.
    const tooBig = chosen.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (tooBig) return setError(`${tooBig.name} 은 10MB 를 넘습니다.`)
    const empty = chosen.find((file) => file.size === 0)
    if (empty) return setError(`${empty.name} 은 빈 파일입니다.`)

    setUploading((n) => n + chosen.length)
    for (const file of chosen) {
      try {
        const attachment = await uploadAttachment(channelId, file)
        setFiles((prev) => [...prev, attachment])
        if (isImage(file.name)) {
          const reader = new FileReader()
          reader.onload = () =>
            setPreviews((prev) => ({ ...prev, [attachment.url]: reader.result as string }))
          reader.readAsDataURL(file)
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : `${file.name} 을 올리지 못했습니다.`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  // 파일을 창 어디에 놓아도 이 대화에 붙인다. 입력창에만 받으면 메시지 목록에 놓은 파일은
  // 브라우저가 그 파일로 화면을 바꿔 버린다. 글이나 문서 줄을 끄는 것은 건드리지 않는다.
  const [dragging, setDragging] = useState(false)
  // 화면 안에서 시작한 끌기. 크롬은 대화 속 그림을 끌 때도 파일이라고 알려서, 가리지 않으면
  // 그림을 살짝 끌었다 놓는 것만으로 같은 그림이 다시 올라간다. dragstart 는 화면 안의 끌기에만 온다.
  const fromPage = useRef(false)
  const onFileDrag = useEffectEvent((e: DragEvent) => {
    if (fromPage.current || !e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    if (e.type === 'dragover') return setDragging(true)
    setDragging(false)
    if (e.type === 'drop') void pick(e.dataTransfer.files)
  })
  useEffect(() => {
    const handle = (e: DragEvent) => onFileDrag(e)
    // 창 밖으로 나가면(`relatedTarget` 이 없다) 안내를 거둔다. 요소 사이를 옮길 때도 dragleave 는 온다.
    const leave = (e: DragEvent) => e.relatedTarget === null && setDragging(false)
    const start = () => (fromPage.current = true)
    const end = () => (fromPage.current = false)
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('dragover', handle)
    window.addEventListener('drop', handle)
    window.addEventListener('dragleave', leave)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('dragover', handle)
      window.removeEventListener('drop', handle)
      window.removeEventListener('dragleave', leave)
    }
  }, [])

  /** 순서를 바꾸려고 끌고 있는 첨부(`url`). 끄는 동안 지나는 첨부의 자리로 바로 옮긴다. */
  const [moving, setMoving] = useState<string | null>(null)
  const move = (url: string, to: number) =>
    setFiles((prev) =>
      reorder(
        prev,
        prev.findIndex((f) => f.url === url),
        to,
      ),
    )

  const dispatch = () => {
    const text = body.trim()
    // 첨부만 보내는 메시지도 있다. 둘 다 없을 때만 막는다.
    if ((!text && files.length === 0) || uploading > 0) return

    // 상한은 서버도 강제하지만, 넘겨 보내면 입력창을 비운 뒤에 거절당해 쓴 글이 사라진다.
    if (text.length > MAX_BODY_CHARS) {
      return setError(`메시지는 ${MAX_BODY_CHARS.toLocaleString()}자까지 보낼 수 있습니다.`)
    }

    // 소켓 전송은 응답이 없다. 닫혀 있으면 여기서 false 가 오고, 그때만 실패를 안다.
    // 서버가 거절하는 경우(멤버 아님 등)는 error 이벤트 → 토스트다(`useChatSocket`).
    const sent = sendMessage(channelId, {
      body: text,
      attachments: files.length > 0 ? files : undefined,
    })
    if (!sent) return setTriedOffline(true)
    markOnboarding('chat')

    // 보낸 뒤에 비운다. 못 보냈을 때 입력창을 되살릴 일이 없다.
    setError(null)
    setTriedOffline(false)
    setBody('')
    setDraft(channelId, '')
    setFiles([])
    setPreviews({})
  }

  const change = (next: string) => {
    setBody(next)
    setDraft(channelId, next)
    onTyping()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    dispatch()
  }

  // 끊김 문구는 끊겨 있는 동안만 보인다. 다시 연결되면 저절로 사라진다.
  const shown = error ?? (triedOffline && !connected ? DISCONNECTED : null)

  // 끊겼다고 보내기 버튼을 잠그지 않는다. 잠그면 누른 사람은 아무 반응도 못 보고, Enter 로
  // 보낸 사람만 이유를 읽는다. 눌러 보고 실패 문구를 읽는 쪽으로 통일한다. 끊겼다는 사실
  // 자체는 헤더 배너가 이미 알린다(`ChatPage`).
  const busy = uploading > 0

  return (
    <form
      onSubmit={submit}
      // 캡처한 화면이나 탐색기에서 복사한 파일을 붙여 넣으면 첨부로 올린다. 글이 같이 든 클립보드
      // (엑셀 칸을 복사하면 글과 그림이 함께 온다)는 글로 붙게 둔다.
      onPaste={(e) => {
        const data = e.clipboardData
        if (data.files.length === 0 || data.types.includes('text/plain')) return
        e.preventDefault()
        void pick(data.files)
      }}
      className="border-line bg-surface border-t px-4 py-3"
    >
      <div className="mx-auto max-w-3xl">
        {dragging && (
          <p className="text-accent mb-2 text-xs">여기에 놓으면 이 대화에 파일이 붙습니다.</p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void pick(e.target.files)
              // 같은 파일을 다시 고를 수 있게 비운다.
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="secondary"
            aria-label="파일 붙이기"
            disabled={uploading > 0}
            onClick={() => picker.current?.click()}
            // 입력칸과 한 줄(items-end)일 때 밑선을 맞춘다. 입력칸은 44px(min-h-11) 행이다.
            className="h-11"
          >
            {uploading > 0 ? <Spinner /> : <Paperclip className="size-4" />}
          </Button>

          {/* 첨부와 글을 테두리 하나로 감싼다. 입력칸 안에 사진이 든 모양이 되어 무엇을 보내는지 보인다. */}
          <div className="border-line bg-canvas focus-within:border-accent min-w-0 flex-1 rounded-lg border transition-colors">
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2 px-2.5 pt-2.5">
                {files.map((file, index) => (
                  <li
                    key={file.url}
                    // 첨부끼리 끌어 순서를 바꾼다. 화면 안에서 시작한 끌기라 창의 파일 놓기는 비킨다(`fromPage`).
                    // 실어 보내는 값은 쓰지 않는다. 파이어폭스가 값이 없으면 끌기를 시작하지 않는다.
                    draggable={files.length > 1}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-zenith-attachment', file.url)
                      e.dataTransfer.effectAllowed = 'move'
                      setMoving(file.url)
                    }}
                    // 포인터가 이 첨부의 가로 가운데를 넘었을 때만 자리를 바꾼다. 닿자마자 바꾸면 넓은
                    // 파일 칩 위에서는 바꾼 뒤에도 포인터가 그 칩 위에 남아 순서가 왔다 갔다 한다.
                    onDragOver={(e) => {
                      if (!moving) return
                      e.preventDefault()
                      const from = files.findIndex((f) => f.url === moving)
                      const box = e.currentTarget.getBoundingClientRect()
                      const pastMiddle = e.clientX > box.left + box.width / 2
                      if (from < index ? pastMiddle : from > index && !pastMiddle)
                        move(moving, index)
                    }}
                    onDragEnd={() => setMoving(null)}
                    // 키보드로는 떼기 버튼에 초점을 두고 Alt+좌우 화살표.
                    onKeyDown={(e) => {
                      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
                      e.preventDefault()
                      move(file.url, index + (e.key === 'ArrowLeft' ? -1 : 1))
                      // 뒤로 옮기면 React 가 이 줄을 뺐다 다시 꽂아 초점이 빠진다. 그대로 두면 이어 누른
                      // Alt+왼쪽이 브라우저의 뒤로 가기가 된다.
                      const button = e.currentTarget.querySelector('button')
                      requestAnimationFrame(() => button?.focus())
                    }}
                    title={
                      files.length > 1
                        ? `${file.name} · 끌거나 Alt+좌우 화살표로 순서 바꾸기`
                        : file.name
                    }
                    className={cn(
                      'relative',
                      files.length > 1 && 'cursor-grab',
                      moving === file.url && 'opacity-40',
                    )}
                  >
                    {previews[file.url] ? (
                      <img
                        src={previews[file.url]}
                        alt={file.name}
                        // 그림만 따로 끌리면 크롬이 파일 끌기로 친다. 줄째로 끌리게 둔다.
                        draggable={false}
                        className="border-line size-16 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="border-line bg-sunken text-muted flex h-16 max-w-40 flex-col justify-center gap-0.5 rounded-lg border px-2.5 text-xs">
                        <span className="flex items-center gap-1.5">
                          <Paperclip className="size-3 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </span>
                        <span className="text-subtle">{formatBytes(file.size)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`${file.name} 떼기`}
                      onClick={() => setFiles((prev) => prev.filter((f) => f.url !== file.url))}
                      className="border-line bg-surface text-subtle hover:text-fg absolute -top-1.5 -right-1.5 grid size-5 cursor-pointer place-items-center rounded-full border"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="relative">
              <MentionTextarea
                value={body}
                onValueChange={change}
                // Tab 으로 쓰던 글 앞에 `/ai ` 를 붙인다. 이미 붙어 있으면 원래대로 초점을 옮긴다.
                // `/a` 까지 친 것은 이어서 채운다. 멘션 목록이 떠 있을 때의 Tab(사람 고르기)은
                // MentionTextarea 가 먼저 받는다.
                onKeyDown={(e) => {
                  if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
                  if (e.nativeEvent.isComposing || isAiCommand(body)) return
                  e.preventDefault()
                  const text = body.trimStart()
                  change('/ai'.startsWith(text.toLowerCase()) ? '/ai ' : `/ai ${text}`)
                }}
                onScroll={(e) => {
                  if (chipLayer.current)
                    chipLayer.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`
                }}
                aria-keyshortcuts="Tab"
                people={mentionCandidates}
                submitOnEnter
                onSubmitEnter={dispatch}
                rows={1}
                aria-label={`${channelName}에 메시지 보내기`}
                // 키보드가 있는 기기는 Tab 안내를 자리글로 둔다. 손가락 기기에는 Tab 키가 없어 방 이름 그대로.
                // ponytail: 열 때 한 번만 본다. 태블릿에 키보드를 붙였다 떼는 경우는 따라가지 않는다.
                placeholder={
                  window.matchMedia?.('(pointer: coarse)').matches
                    ? `${hash ? '#' : ''}${channelName}에 메시지 보내기…`
                    : 'Tab 을 누르면 /ai 가 입력됩니다'
                }
                // 테두리는 감싼 칸이 그린다. 높이는 그 테두리 2px 을 빼서 옆 버튼(44px)과 밑선을 맞춘다.
                className="max-h-40 min-h-[calc(2.75rem-2px)] border-0 bg-transparent"
              />
              {/* textarea 는 글자 일부만 색을 못 바꾼다. 같은 글꼴·여백으로 `/ai` 자리에 칩을 덮어 그린다.
                칩은 맨 앞 커맨드라 앞의 빈칸·줄바꿈만 같이 그리면 자리가 맞는다(뒤 글의 줄바꿈과 무관).
                ponytail: 칩이 불투명해 커서가 `/ai` 글자 사이에 있으면 가려진다. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2.5 text-sm break-words whitespace-pre-wrap pointer-coarse:text-base"
              >
                <div ref={chipLayer}>
                  {isAiCommand(body) && (
                    <>
                      {body.slice(0, body.indexOf('/ai'))}
                      <span className="bg-accent-soft text-accent rounded-sm">/ai</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <Button
            type="submit"
            disabled={(!body.trim() && files.length === 0) || busy}
            aria-label="보내기"
            className="h-11"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>

      {shown && (
        <p role="alert" className="text-danger mx-auto mt-2 max-w-3xl text-xs">
          {shown}
        </p>
      )}
    </form>
  )
}
