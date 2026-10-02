import { hueOf } from '@/lib/avatar'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Quote } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatRelative } from '@/lib/datetime'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { MentionTextarea } from '@/features/people/MentionTextarea'
import { useMentionNames } from '@/features/people/colleagues'
import { MentionText } from '@/features/people/MentionText'
import { useAddComment, useComments } from './api'
import { anchoredBlocks, flashElement } from './blockId'
import { COMMENT_BODY_MAX, type DocComment } from './types'

/** 댓글 한 줄. 옆 패널과 블록 옆 창(BlockComments)이 같이 쓴다. `children` 은 이름과 본문 사이(인용). */
export function CommentRow({
  comment,
  names,
  id,
  children,
}: {
  comment: DocComment
  names: ReadonlySet<string>
  id?: string
  children?: ReactNode
}) {
  return (
    <div id={id} className="-mx-2 flex gap-2.5 rounded-lg px-2 py-1">
      <Avatar name={comment.author.name} hue={hueOf(comment.author.id)} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-fg text-xs font-medium">
          {comment.author.name}
          <span className="text-subtle ml-1.5 font-normal">
            {formatRelative(comment.created_at)}
          </span>
        </p>
        {children}
        <p className="text-muted mt-0.5 text-sm break-words whitespace-pre-wrap">
          <MentionText body={comment.body} names={names} />
        </p>
      </div>
    </div>
  )
}

/**
 * 문서의 모든 댓글(오래된 순)과 문서 전체에 다는 입력칸. 블록에 다는 댓글은 본문의 그 블록 옆
 * 창(BlockComments)에서 쓰고, 여기에는 어느 블록인지 인용과 함께 같이 쌓인다.
 */
export function CommentPanel({
  docId,
  editor,
  onJump,
}: {
  docId: string
  editor: Editor | null
  /** 그 블록으로 굴려 가서 밝힌다. 버전 미리보기가 본문을 가리고 있으면 닫는 것도 여기서. */
  onJump: (blockId: string) => void
}) {
  const user = useCurrentUser()
  const { data, isPending } = useComments(docId)
  const addComment = useAddComment(docId)
  const names = useMentionNames()
  const [body, setBody] = useState('')

  // 닻이 달린 블록의 지금 앞부분. 본문이 바뀌면 인용도 따라가고, 지워진 블록은 빠진다.
  const blocks =
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? anchoredBlocks(e.state.doc) : {}),
    }) ?? {}

  // 멘션 알림은 `/docs/{문서}?comment={댓글}` 로 온다. 그 댓글로 내려 밝히고, 주소에서 파라미터를
  // 걷는다(새로고침·탭 왕복 때 다시 튀지 않게, 같은 알림을 또 누르면 다시 동작하게).
  // 블록에 달린 댓글이면 본문도 그 블록으로 보낸다. 블록은 Y.Doc 이 동기화된 뒤에야 생기므로
  // 파라미터를 걷은 뒤에도 나타날 때까지 기다린다(`pendingJump`).
  const [params, setParams] = useSearchParams()
  const focusId = params.get('comment')
  const focused = data?.items.find((comment) => comment.id === focusId)
  const focusedId = focused?.id ?? null
  // 없거나 볼 수 없는 댓글이면 파라미터만 걷는다. 남겨 두면 새로고침마다 패널이 다시 펼쳐진다.
  const focusMissing = data !== undefined && focusId !== null && !focused

  // 찾아온 댓글마다 한 번씩 블록 이동을 예약한다. `seq` 는 같은 알림을 다시 눌러 같은 댓글로
  // 또 올 때도 새 예약이 되게 한다(렌더 중 상태 조정, effect 에서 setState 하지 않는다).
  const [seenId, setSeenId] = useState<string | null>(null)
  const [pendingJump, setPendingJump] = useState<{ blockId: string; seq: number } | null>(null)
  if (focusedId !== seenId) {
    setSeenId(focusedId)
    if (focused?.block_id) {
      setPendingJump({ blockId: focused.block_id, seq: (pendingJump?.seq ?? 0) + 1 })
    }
  }

  useEffect(() => {
    if (!focusedId && !focusMissing) return
    const row = focusedId ? document.getElementById(`comment-${focusedId}`) : null
    if (row) {
      row.scrollIntoView({ block: 'nearest' })
      flashElement(row)
    }
    setParams(
      (prev) => {
        prev.delete('comment')
        return prev
      },
      { replace: true },
    )
  }, [focusedId, focusMissing, setParams])

  const jumpReady = pendingJump !== null && blocks[pendingJump.blockId] !== undefined
  const jumpedSeq = useRef(0)
  useEffect(() => {
    if (!pendingJump || !jumpReady || jumpedSeq.current === pendingJump.seq) return
    jumpedSeq.current = pendingJump.seq
    onJump(pendingJump.blockId)
  }, [pendingJump, jumpReady, onJump])

  // 방금 단 댓글로 내려 준다. 등록 응답 시점에는 목록이 아직 옛것이라(다시 받아 오는 중),
  // 새 목록에 그 행이 실린 뒤에 움직인다.
  const sentId = useRef<string | null>(null)
  useEffect(() => {
    const row = sentId.current && document.getElementById(`comment-${sentId.current}`)
    if (!row) return
    sentId.current = null
    row.scrollIntoView({ block: 'nearest' })
  }, [data])

  const send = () => {
    const text = body.trim()
    if (!text || addComment.isPending) return
    addComment.mutate(
      { body: text },
      {
        onSuccess: (comment) => {
          sentId.current = comment.id
          setBody('')
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
            <CommentRow
              key={comment.id}
              comment={comment}
              names={names}
              id={`comment-${comment.id}`}
            >
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
            </CommentRow>
          )
        })}
      </div>

      <form onSubmit={submit} className="border-line border-t p-3">
        {/* 등록 버튼은 입력칸 옆에 둔다(채팅 입력줄과 같은 배치). 모바일에서 이 패널은 화면의 45% 안에
            있어, 버튼만 있는 줄과 두 줄 높이 입력칸이 댓글 목록 자리를 거의 다 먹었다. 글자를 줄이는 대신
            높이를 줄인다(16px 미만이면 iOS 가 포커스 때 확대한다). */}
        <div className="flex items-end gap-2">
          <Avatar name={user.name} hue={hueOf(user.id)} size="sm" className="mb-2" />
          {/* Enter 로 등록하고 줄바꿈은 Shift+Enter. 댓글은 짧게 여러 번 쓰는 쪽이 많다.
              `@` 를 치면 사람 목록이 뜬다. 거기서의 Enter 는 고르기다. */}
          <MentionTextarea
            value={body}
            onValueChange={setBody}
            submitOnEnter
            onSubmitEnter={send}
            rows={1}
            maxLength={COMMENT_BODY_MAX}
            aria-label="문서 전체에 댓글"
            placeholder="문서 전체에 댓글…"
            className="min-h-11 w-full lg:min-h-16"
          />
          <Button
            type="submit"
            disabled={!body.trim() || addComment.isPending}
            className="h-11 shrink-0"
          >
            {addComment.isPending ? <Spinner className="border-t-on-accent" /> : '등록'}
          </Button>
        </div>
        {/* 안내를 자리글에 같이 넣으면 좁은 화면에서 두 줄이 되며 아랫줄이 잘린다.
            컴포저들과 같이 입력창 아래로 뺐다. 좁은 폭에서는 줄째 감춘다(물리 키보드가 없고,
            이 패널은 모바일에서 화면의 45% 안에서 접었다 편다). */}
        <p className="text-subtle mt-2 hidden text-right text-[11px] sm:block">
          Enter 등록 · Shift+Enter 줄바꿈
        </p>
      </form>
    </>
  )
}
