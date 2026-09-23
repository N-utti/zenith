import { hueOf } from '@/lib/avatar'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Quote, X } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { MentionTextarea } from '@/features/people/MentionTextarea'
import { splitMentions } from '@/features/people/mentions'
import { useAddComment, useComments } from './api'
import { anchoredBlocks } from './blockId'
import { COMMENT_BODY_MAX } from './types'

/** 댓글을 달 블록. 손잡이·툴바의 「댓글」이 정한다. */
export type CommentTarget = { blockId: string; preview: string }

/** 본문의 `@이름` 을 배지로. 서버가 알림을 만드는 규칙과 같은 자리를 칠한다. */
function CommentBody({ body }: { body: string }) {
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

export function CommentPanel({
  docId,
  editor,
  target,
  onClearTarget,
  onJump,
}: {
  docId: string
  editor: Editor | null
  target: CommentTarget | null
  onClearTarget: () => void
  /** 그 블록으로 굴려 가서 밝힌다. 버전 미리보기가 본문을 가리고 있으면 닫는 것도 여기서. */
  onJump: (blockId: string) => void
}) {
  const user = useCurrentUser()
  const { data, isPending } = useComments(docId)
  const addComment = useAddComment(docId)
  const [body, setBody] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 닻이 달린 블록의 지금 앞부분. 본문이 바뀌면 인용도 따라가고, 지워진 블록은 빠진다.
  const blocks =
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? anchoredBlocks(e.state.doc) : {}),
    }) ?? {}

  // 블록을 고르고 들어오면 바로 쓸 수 있게 입력칸으로 간다.
  useEffect(() => {
    if (target) inputRef.current?.focus()
  }, [target])

  // 멘션 알림은 `/docs/{문서}?comment={댓글}` 로 온다. 그 댓글로 내리고, 블록에 달린 것이면
  // 본문도 그 블록으로 보낸다. 블록은 Y.Doc 이 동기화된 뒤에야 생기므로 나타날 때까지 기다린다.
  const [params] = useSearchParams()
  const focusId = params.get('comment')
  const focused = data?.items.find((comment) => comment.id === focusId)
  const jumpTo = focused?.block_id && blocks[focused.block_id] ? focused.block_id : null
  const found = focused !== undefined
  useEffect(() => {
    if (focusId && found) document.getElementById(`comment-${focusId}`)?.scrollIntoView()
  }, [focusId, found])
  const jumpedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!jumpTo || jumpedFor.current === focusId) return
    jumpedFor.current = focusId
    onJump(jumpTo)
  }, [focusId, jumpTo, onJump])

  const send = () => {
    const text = body.trim()
    if (!text || addComment.isPending) return
    addComment.mutate(
      { body: text, block_id: target?.blockId },
      {
        onSuccess: () => {
          setBody('')
          onClearTarget()
        },
      },
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {isPending && <Spinner />}
        {data?.items.length === 0 && <p className="text-subtle text-sm">첫 댓글을 남겨 보세요.</p>}
        {data?.items.map((comment) => {
          const quote = comment.block_id ? blocks[comment.block_id] : undefined
          return (
            <div
              key={comment.id}
              id={`comment-${comment.id}`}
              className={cn(
                '-mx-2 flex gap-2.5 rounded-lg px-2 py-1',
                comment.id === focusId && 'animate-flash',
              )}
            >
              <Avatar name={comment.author.name} hue={hueOf(comment.author.id)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-fg text-xs font-medium">
                  {comment.author.name}
                  <span className="text-subtle ml-1.5 font-normal">
                    {formatRelative(comment.created_at)}
                  </span>
                </p>
                {comment.block_id &&
                  (quote !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onJump(comment.block_id!)}
                      title="본문에서 이 블록 보기"
                      className="bg-sunken text-muted hover:text-fg mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors"
                    >
                      <Quote className="size-3 shrink-0" />
                      <span className="truncate">{quote}</span>
                    </button>
                  ) : (
                    <p className="bg-sunken text-subtle mt-1 rounded-md px-2 py-1 text-xs">
                      지워진 블록
                    </p>
                  ))}
                <p className="text-muted mt-0.5 text-sm break-words whitespace-pre-wrap">
                  <CommentBody body={comment.body} />
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <form onSubmit={submit} className="border-line border-t p-3">
        {target && (
          <div className="bg-sunken text-muted mb-2 flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs">
            <Quote className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">이 블록에 댓글: {target.preview}</span>
            <button
              type="button"
              onClick={onClearTarget}
              aria-label="블록 지정 풀기 (문서 전체에 댓글)"
              title="문서 전체에 댓글"
              className="text-subtle hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex gap-2.5">
          <Avatar name={user.name} hue={hueOf(user.id)} size="sm" />
          {/* Enter 로 등록하고 줄바꿈은 Shift+Enter. 댓글은 짧게 여러 번 쓰는 쪽이 많다.
              `@` 를 치면 사람 목록이 뜬다. 거기서의 Enter 는 고르기다. */}
          <MentionTextarea
            inputRef={inputRef}
            value={body}
            onValueChange={setBody}
            submitOnEnter
            onSubmitEnter={send}
            rows={2}
            maxLength={COMMENT_BODY_MAX}
            aria-label="댓글"
            placeholder="댓글 남기기…"
            className="min-h-16 w-full"
          />
        </div>
        {/* 안내를 자리글에 같이 넣으면 좁은 화면에서 두 줄이 되며 아랫줄이 잘린다.
            컴포저들과 같이 입력창 아래로 뺐다. 좁은 폭에서는 감춘다(물리 키보드가 없고,
            이 패널은 모바일에서 화면의 45% 안에서 접었다 편다). */}
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-subtle hidden text-[11px] sm:inline">
            Enter 등록 · Shift+Enter 줄바꿈
          </span>
          <Button type="submit" size="sm" disabled={!body.trim() || addComment.isPending}>
            {addComment.isPending ? <Spinner className="border-t-on-accent" /> : '등록'}
          </Button>
        </div>
      </form>
    </>
  )
}
