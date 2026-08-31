import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { ApiError } from '@/lib/api'
import { useSendMessage } from './api'

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
  const [body, setBody] = useState('')

  const dispatch = () => {
    const text = body.trim()
    if (!text || send.isPending) return
    // 성공은 WebSocket 이벤트로 확인된다. 입력창은 먼저 비워도 안전하다.
    setBody('')
    send.mutate(text, { onError: () => setBody(text) })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    dispatch()
  }

  return (
    <form onSubmit={submit} className="border-line bg-surface border-t px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
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
        <Button type="submit" disabled={!body.trim() || send.isPending} aria-label="보내기">
          {send.isPending ? <Spinner className="border-t-on-accent" /> : <Send className="size-4" />}
        </Button>
      </div>

      {send.isError && (
        <p role="alert" className="text-danger mx-auto mt-2 max-w-3xl text-xs">
          {send.error instanceof ApiError ? send.error.message : '메시지를 보내지 못했습니다.'}
        </p>
      )}
    </form>
  )
}
