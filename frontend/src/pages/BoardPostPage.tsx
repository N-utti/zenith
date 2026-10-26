import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { Forbidden } from '@/components/Forbidden'
import { Avatar } from '@/components/ui/Avatar'
import { BackLink } from '@/components/ui/BackLink'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/datetime'
import { useBoards, useDeletePost, usePost, useUpdatePost } from '@/features/board/api'
import { AttachmentList } from '@/features/approvals/AttachmentList'
import { PostComments } from '@/features/board/PostComments'
import { PostComposer } from '@/features/board/PostComposer'
import { useCurrentUser } from '@/features/auth/AuthContext'

export function BoardPostPage() {
  const { postId = '' } = useParams()
  const { data: post, isPending, error } = usePost(postId)
  const me = useCurrentUser()
  // 무효화할 목록은 주소가 아니라 글이 실제로 속한 게시판이다. 라우트는 어긋난 게시판 id 로도
  // 열리는데(`/board/all/p-6`), 그때 주소를 믿으면 정작 그 글이 있는 목록이 stale 로 남는다.
  const postBoardId = post?.board_id ?? ''
  const board = useBoards().data?.items.find((b) => b.id === postBoardId)
  const navigate = useNavigate()
  const toast = useToast()
  const remove = useDeletePost(postBoardId, postId)
  const pin = useUpdatePost(postBoardId, postId)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // 버튼을 띄울지의 판단일 뿐이다. 실제 차단은 서버가 한다(PATCH·DELETE 의 403).
  const canEdit = Boolean(post) && (post?.author?.id === me.id || me.role === 'exec')

  const confirmDelete = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false)
        toast.success('글을 지웠습니다.')
        void navigate(`/board/${postBoardId}`, { replace: true })
      },
      onError: (err) => {
        setConfirming(false)
        toast.error(err instanceof ApiError ? err.message : '글을 지우지 못했습니다.')
      },
    })

  const togglePin = () =>
    pin.mutate(
      { pinned: !post?.pinned },
      {
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : '고정을 바꾸지 못했습니다.'),
      },
    )

  if (isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <Forbidden to="/board" back="게시판으로 돌아가기">
          이 글을 볼 수 있는 등급이 아닙니다.
        </Forbidden>
      )
    }
    return (
      <div className="py-20 text-center">
        <h1 className="text-fg text-lg font-semibold">글을 찾을 수 없습니다</h1>
        <Link to="/board" className="text-accent mt-4 inline-block text-sm hover:underline">
          게시판으로 돌아가기 →
        </Link>
      </div>
    )
  }

  return (
    <>
      <BackLink to={`/board/${postBoardId}`}>목록</BackLink>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-fg flex items-start gap-2 text-xl font-semibold">
            {post.pinned && <Pin className="text-accent mt-1 size-4 shrink-0" />}
            {post.title}
          </h1>
          {canEdit && (
            <div className="flex shrink-0 gap-2">
              {/* 서버가 `pinned` 를 줄 때만 띄운다. 지금 실서버는 모르는 칸을 버려서 눌러도 그대로다(#528). */}
              {post.pinned !== undefined && (
                <Button variant="secondary" size="sm" onClick={togglePin} disabled={pin.isPending}>
                  {post.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {post.pinned ? '고정 해제' : '고정'}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={!board}
              >
                <Pencil className="size-4" />
                수정
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                <Trash2 className="size-4" />
                삭제
              </Button>
            </div>
          )}
        </div>

        <div className="text-subtle mt-3 flex items-center gap-2 text-xs">
          <Avatar name={post.author?.name ?? '?'} hue={200} size="sm" />
          {post.author?.name ?? '알 수 없음'}
          <span>·</span>
          {formatRelative(post.created_at)}
        </div>

        <div className="border-line mt-5 border-t pt-5">
          <p className="text-fg text-[15px] leading-7 whitespace-pre-wrap">{post.body}</p>
          {/* 서버가 준 대로 그린다. 받을 때 서버가 게시판 등급으로 다시 판정한다. */}
          {post.attachments.length > 0 && (
            <div className="mt-5">
              <AttachmentList files={post.attachments} />
            </div>
          )}
        </div>
      </Card>

      {/* 글을 볼 수 있는 사람만 여기까지 온다(본문 403 은 위에서 끝난다). 글마다 새로 만든다. */}
      <PostComments key={post.id} postId={post.id} />

      {board && editing && (
        <PostComposer board={board} post={post} onClose={() => setEditing(false)} />
      )}

      <Modal
        open={confirming}
        onClose={() => {
          if (!remove.isPending) setConfirming(false)
        }}
        title="글을 지울까요?"
        description="지운 글은 되돌릴 수 없습니다."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={remove.isPending}
            >
              취소
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending ? <Spinner className="border-t-white" /> : '지우기'}
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm leading-relaxed">{post.title}</p>
      </Modal>
    </>
  )
}
