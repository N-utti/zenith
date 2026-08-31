import { useState, type FormEvent } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { formatRelative } from '@/lib/datetime'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useAddComment, useComments } from './api'

export function CommentPanel({ docId }: { docId: string }) {
  const user = useCurrentUser()
  const { data, isPending } = useComments(docId)
  const addComment = useAddComment(docId)
  const [body, setBody] = useState('')

  const send = () => {
    const text = body.trim()
    if (!text || addComment.isPending) return
    addComment.mutate(text, { onSuccess: () => setBody('') })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {isPending && <Spinner />}
        {data?.items.length === 0 && (
          <p className="text-subtle text-sm">첫 댓글을 남겨 보세요.</p>
        )}
        {data?.items.map((comment) => (
          <div key={comment.id} className="flex gap-2.5">
            <Avatar name={comment.authorName} hue={comment.authorHue} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-fg text-xs font-medium">
                {comment.authorName}
                <span className="text-subtle ml-1.5 font-normal">
                  {formatRelative(comment.createdAt)}
                </span>
              </p>
              <p className="text-muted mt-0.5 text-sm break-words whitespace-pre-wrap">
                {comment.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="border-line border-t p-3">
        <div className="flex gap-2.5">
          <Avatar name={user.name} hue={user.avatarHue} size="sm" />
          {/* 줄바꿈은 Shift+Enter. 댓글은 짧게 여러 번 쓰는 쪽이 많다. */}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            submitOnEnter
            onSubmitEnter={send}
            rows={2}
            aria-label="댓글"
            placeholder="댓글 남기기…  (Enter 등록 · Shift+Enter 줄바꿈)"
            className="min-h-16 flex-1"
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || addComment.isPending}>
            {addComment.isPending ? <Spinner className="border-t-on-accent" /> : '등록'}
          </Button>
        </div>
      </form>
    </>
  )
}
