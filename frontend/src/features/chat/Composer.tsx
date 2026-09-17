import { useRef, useState, type FormEvent } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { ApiError } from '@/lib/api'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, useSendMessage, useUploadAttachment } from './api'
import type { ChatAttachment } from './types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function Composer({
  channelId,
  channelName,
  onTyping,
}: {
  channelId: string
  channelName: string
  onTyping: () => void
}) {
  const send = useSendMessage(channelId)
  const upload = useUploadAttachment(channelId)
  const [body, setBody] = useState('')
  /** 올려 둔 파일. 보내기 전까지는 서버에만 있고 어느 메시지에도 안 붙어 있다. */
  const [files, setFiles] = useState<ChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const pick = (list: FileList | null) => {
    setError(null)
    const chosen = [...(list ?? [])]
    if (chosen.length === 0) return
    if (files.length + chosen.length > MAX_ATTACHMENTS) {
      return setError(`파일은 ${MAX_ATTACHMENTS}개까지 붙일 수 있습니다.`)
    }
    // 상한은 서버가 강제하지만 여기서 먼저 걸러야 10MB 를 올렸다가 422 를 보지 않는다.
    const tooBig = chosen.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (tooBig) return setError(`${tooBig.name} 은 10MB 를 넘습니다.`)
    const empty = chosen.find((file) => file.size === 0)
    if (empty) return setError(`${empty.name} 은 빈 파일입니다.`)

    for (const file of chosen) {
      upload.mutate(file, {
        onSuccess: (attachment) => setFiles((prev) => [...prev, attachment]),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : `${file.name} 을 올리지 못했습니다.`),
      })
    }
  }

  const dispatch = () => {
    const text = body.trim()
    // 첨부만 보내는 메시지도 있다. 둘 다 없을 때만 막는다.
    if ((!text && files.length === 0) || send.isPending || upload.isPending) return
    // 성공은 WebSocket 이벤트로 확인된다. 입력창은 먼저 비워도 안전하다.
    setBody('')
    setFiles([])
    send.mutate(
      { body: text, attachments: files.length > 0 ? files : undefined },
      {
        onError: () => {
          setBody(text)
          setFiles(files)
        },
      },
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    dispatch()
  }

  const busy = send.isPending || upload.isPending

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
                <span className="text-subtle">{formatSize(file.size)}</span>
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
              pick(e.target.files)
              // 같은 파일을 다시 고를 수 있게 비운다.
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="secondary"
            aria-label="파일 붙이기"
            disabled={upload.isPending}
            onClick={() => picker.current?.click()}
          >
            {upload.isPending ? <Spinner /> : <Paperclip className="size-4" />}
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
            {send.isPending ? (
              <Spinner className="border-t-on-accent" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {(error || send.isError) && (
        <p role="alert" className="text-danger mx-auto mt-2 max-w-3xl text-xs">
          {error ??
            (send.error instanceof ApiError ? send.error.message : '메시지를 보내지 못했습니다.')}
        </p>
      )}
    </form>
  )
}
