import { useRef, useState, type FormEvent } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, uploadAttachment } from './api'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatAttachment } from './types'

export function Composer({
  channelId,
  channelName,
  onTyping,
}: {
  channelId: string
  channelName: string
  onTyping: () => void
}) {
  const { connected, sendMessage } = useChatSocketContext()
  const [body, setBody] = useState('')
  /** 올려 둔 파일. 보내기 전까지는 서버에만 있고 어느 메시지에도 안 붙어 있다. */
  const [files, setFiles] = useState<ChatAttachment[]>([])
  /** 올라가는 중인 개수. 개수 상한은 이것까지 세야 한다. */
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
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

    // 소켓 전송은 응답이 없다. 닫혀 있으면 여기서 false 가 오고, 그때만 실패를 안다.
    // 서버가 거절하는 경우(멤버 아님 등)는 error 이벤트 → 토스트다(`useChatSocket`).
    const sent = sendMessage(channelId, {
      body: text,
      attachments: files.length > 0 ? files : undefined,
    })
    if (!sent) {
      return setError('연결이 끊겨 보내지 못했습니다. 연결되면 다시 시도하세요.')
    }

    // 보낸 뒤에 비운다. 못 보냈을 때 입력창을 되살릴 일이 없다.
    setError(null)
    setBody('')
    setFiles([])
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    dispatch()
  }

  // 끊긴 동안은 보낼 길이 없다. 전에는 REST 라 끊겨도 보내졌지만 이제 전송이 소켓이다.
  const busy = uploading > 0 || !connected

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

          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              onTyping()
            }}
            submitOnEnter
            onSubmitEnter={dispatch}
            rows={1}
            aria-label={`${channelName}에 메시지 보내기`}
            placeholder={`${channelName}에 메시지 보내기…  (Enter 전송 · Shift+Enter 줄바꿈)`}
            className="max-h-40 min-h-11 flex-1"
          />
          <Button
            type="submit"
            disabled={(!body.trim() && files.length === 0) || busy}
            aria-label="보내기"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-danger mx-auto mt-2 max-w-3xl text-xs">
          {error}
        </p>
      )}
    </form>
  )
}
