import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Lock, Pencil, Pin, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { BackLink } from '@/components/ui/BackLink'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/datetime'
import { POST_COMMENTS_ENABLED, useBoards, useDeletePost, usePost } from '@/features/board/api'
import { AttachmentList } from '@/features/approvals/AttachmentList'
import { PostComments } from '@/features/board/PostComments'
import { PostComposer } from '@/features/board/PostComposer'
import { useCurrentUser } from '@/features/auth/AuthContext'

/**
 * 열람 권한이 없을 때. 05 "상태·엣지 케이스"가 요구하는 **전용 403 화면**이다.
 *
 * 목록에서는 마스킹으로 막지만 주소를 직접 치고 들어올 수 있다. 그때 빈 화면이나
 * 일반 오류를 보여주면 "고장"으로 읽힌다. 막혔다는 사실과 이유를 밝힌다.
 */
function Forbidden() {
  return (
    <div className="grid place-items-center py-20 text-center">
      <div className="max-w-sm">
        <span className="bg-sunken text-subtle mx-auto grid size-12 place-items-center rounded-xl">
          <Lock className="size-5" />
        </span>
        <h1 className="text-fg mt-4 text-lg font-semibold">열람 권한이 없습니다</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          {/* 서버 403 은 code·detail 뿐이라 몇 등급부터인지는 모른다(routers/boards.py). */}
          이 글을 볼 수 있는 등급이 아닙니다.
          <br />
          권한이 필요하면 경영지원팀에 문의해 주세요.
        </p>
        <Link to="/board" className="text-accent mt-5 inline-block text-sm hover:underline">
          게시판으로 돌아가기 →
        </Link>
      </div>
    </div>
  )
}

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

  if (isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return <Forbidden />
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
          {post.attachments && post.attachments.length > 0 && (
            <div className="mt-5">
              <AttachmentList files={post.attachments} />
            </div>
          )}
        </div>
      </Card>

      {/* 글을 볼 수 있는 사람만 여기까지 온다(본문 403 은 위에서 끝난다). 글마다 새로 만든다. */}
      {POST_COMMENTS_ENABLED && <PostComments key={post.id} postId={post.id} />}

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
