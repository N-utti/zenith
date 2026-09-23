import { useRef, useState, type FormEvent } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { MentionTextarea } from '@/features/people/MentionTextarea'
import { ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY_CHARS, uploadAttachment } from './api'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatAttachment, Person } from './types'

/** 끊겨서 못 보냈다는 문구. 다시 연결되면 이 문구만 지운다. */
const DISCONNECTED = '연결이 끊겨 보내지 못했습니다. 연결되면 다시 시도하세요.'

export function Composer({
  channelId,
  channelName,
  isDm,
  mentionCandidates,
  onTyping,
}: {
  channelId: string
  channelName: string
  /** DM 이 아닌 채널은 이름 앞에 `#` 을 붙인다(채널 목록·헤더와 같은 표기). */
  isDm: boolean
  /** @ 자동완성 후보(DM 은 상대만, 채널은 멤버 전원). */
  mentionCandidates: Person[]
  onTyping: () => void
}) {
  const { connected, sendMessage } = useChatSocketContext()
  const [body, setBody] = useState('')
  /** 올려 둔 파일. 보내기 전까지는 서버에만 있고 어느 메시지에도 안 붙어 있다. */
  const [files, setFiles] = useState<ChatAttachment[]>([])
  /** 올라가는 중인 개수. 개수 상한은 이것까지 세야 한다. */
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /**
   * 끊겨서 못 보낸 적이 있는지. 문구를 상태에 담지 않고 이 깃발과 `connected` 로 만든다.
   * 담아 두면 다시 연결된 뒤에도 지울 곳이 없어 빨간 문구가 남는다.
   */
  const [triedOffline, setTriedOffline] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

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
      } catch (err) {
        setError(err instanceof ApiError ? err.message : `${file.name} 을 올리지 못했습니다.`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

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

    // 보낸 뒤에 비운다. 못 보냈을 때 입력창을 되살릴 일이 없다.
    setError(null)
    setTriedOffline(false)
    setBody('')
    setFiles([])
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
    <form onSubmit={submit} className="border-line bg-surface border-t px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {files.map((file) => (
              <li
                key={file.url}
                className="border-line bg-sunken text-muted flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs"
              >
                <Paperclip className="size-3 shrink-0" />
                <span className="max-w-40 truncate">{file.name}</span>
                <span className="text-subtle">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`${file.name} 떼기`}
                  onClick={() => setFiles((prev) => prev.filter((f) => f.url !== file.url))}
                  className="text-subtle hover:text-fg cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
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
          >
            {uploading > 0 ? <Spinner /> : <Paperclip className="size-4" />}
          </Button>

          <MentionTextarea
            value={body}
            onValueChange={(next) => {
              setBody(next)
              onTyping()
            }}
            people={mentionCandidates}
            submitOnEnter
            onSubmitEnter={dispatch}
            rows={1}
            aria-label={`${channelName}에 메시지 보내기`}
            placeholder={`${isDm ? '' : '#'}${channelName}에 메시지 보내기…`}
            className="max-h-40 min-h-11"
          />
          <Button
            type="submit"
            disabled={(!body.trim() && files.length === 0) || busy}
            aria-label="보내기"
          >
            <Send className="size-4" />
          </Button>
        </div>

        {/* 단축키 안내는 자리글이 아니라 입력창 아래 한 줄로 둔다(AI 컴포저와 같은 자리).
            자리글에 같이 넣으면 좁은 화면에서 두 줄이 되는데 입력창은 한 줄 높이(min-h-11)라
            아랫줄이 잘린다. 좁은 폭에서는 아예 감춘다. 물리 키보드가 없어 알릴 내용이 없고,
            메시지 목록의 세로를 상시로 먹을 이유도 없다. */}
        <p className="text-subtle mt-2 hidden text-center text-[11px] sm:block">
          Enter 전송 · Shift+Enter 줄바꿈
        </p>
      </div>

      {shown && (
        <p role="alert" className="text-danger mx-auto mt-2 max-w-3xl text-xs">
          {shown}
        </p>
      )}
    </form>
  )
}
