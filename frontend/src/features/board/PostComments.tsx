import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { CommentRow } from '@/features/comments/CommentRow'
import { ApiError } from '@/lib/api'
import { useAddPostComment, useDeletePostComment, useEditPostComment, usePostComments } from './api'
import { POST_COMMENT_MAX } from './types'

/** 게시글 댓글은 멘션을 쓰지 않는다. 본문의 `@이름` 을 배지로 그리지 않게 빈 집합을 넘긴다. */
const NO_MENTIONS: ReadonlySet<string> = new Set()

/**
 * 게시글 아래의 댓글. 오래된 순으로 쌓이고 맨 아래에 입력칸이 있다.
 *
 * 줄은 문서 댓글과 같은 부품이다(`features/comments/CommentRow`). 고치기는 쓴 사람만, 지우기는
 * 쓴 사람과 임원이 한다(글 지우기와 같은 기준). 버튼을 감추는 것은 화면 편의이고 차단은 서버의 403 이다.
 *
 * 멘션(`@`)이 없다. 등급 게시판의 댓글에서 등급 밖 사람을 부르면 그 사람에게 가는 알림에 글 제목과
 * 댓글이 실린다. 서버도 본문의 `@이름` 을 해석하지 않는다(백엔드 #303).
 */
export function PostComments({ postId }: { postId: string }) {
  const me = useCurrentUser()
  const { data, isPending, isError } = usePostComments(postId)
  const add = useAddPostComment(postId)
  const edit = useEditPostComment(postId)
  const remove = useDeletePostComment(postId)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const send = () => {
    const text = body.trim()
    if (!text || add.isPending) return
    setError(null)
    add.mutate(text, {
      onSuccess: () => setBody(''),
      // 쓰던 글은 그대로 둔다. 입력칸 아래에 이유를 낸다.
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : '댓글을 등록하지 못했습니다.'),
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }

  const items = data?.items ?? []

  return (
    <Card className="mt-4 p-6">
      <h2 className="text-fg text-sm font-semibold">
        댓글{data && items.length > 0 && <span className="text-subtle ml-1.5">{items.length}</span>}
      </h2>

      <div className="mt-3 space-y-3">
        {isPending && <Spinner />}
        {/* 받아 둔 목록이 있으면 다시 받기 실패는 알리지 않는다(옛 목록과 문구가 같이 뜨지 않게). */}
        {isError && !data && <p className="text-subtle text-sm">댓글을 불러오지 못했습니다.</p>}
        {data && items.length === 0 && (
          <p className="text-subtle text-sm">첫 댓글을 남겨 보세요.</p>
        )}
        {items.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            names={NO_MENTIONS}
            canEdit={comment.author.id === me.id}
            canDelete={comment.author.id === me.id || me.role === 'exec'}
            maxLength={POST_COMMENT_MAX}
            onSave={(next) => edit.mutateAsync({ id: comment.id, body: next })}
            onRemove={() => remove.mutateAsync(comment.id)}
          />
        ))}
      </div>

      <form onSubmit={submit} className="border-line mt-4 border-t pt-4">
        <div className="flex items-end gap-2">
          {/* Enter 로 등록하고 줄바꿈은 Shift+Enter(문서 댓글과 같다). */}
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setError(null)
            }}
            submitOnEnter
            onSubmitEnter={send}
            rows={1}
            maxLength={POST_COMMENT_MAX}
            aria-label="댓글"
            aria-invalid={error ? true : undefined}
            placeholder="댓글을 남겨 보세요"
            className="min-h-11 w-full resize-none"
          />
          <Button type="submit" disabled={!body.trim() || add.isPending} className="h-11 shrink-0">
            {add.isPending ? <Spinner className="border-t-on-accent" /> : '등록'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-danger mt-2 text-xs">
            {error}
          </p>
        )}
      </form>
    </Card>
  )
}
