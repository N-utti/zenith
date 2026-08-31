import { Link, useParams } from 'react-router'
import { ChevronLeft, Lock, Pin } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/datetime'
import { usePost } from '@/features/board/api'
import { ROLE_LABEL, type Role } from '@/types'

/**
 * 열람 권한이 없을 때. 05 "상태·엣지 케이스"가 요구하는 **전용 403 화면**이다.
 *
 * 목록에서는 마스킹으로 막지만 주소를 직접 치고 들어올 수 있다. 그때 빈 화면이나
 * 일반 오류를 보여주면 "고장"으로 읽힌다 — 막혔다는 사실과 이유를 밝힌다.
 */
function Forbidden({ requiredRole }: { requiredRole?: Role }) {
  return (
    <div className="grid place-items-center py-20 text-center">
      <div className="max-w-sm">
        <span className="bg-sunken text-subtle mx-auto grid size-12 place-items-center rounded-xl">
          <Lock className="size-5" />
        </span>
        <h1 className="text-fg mt-4 text-lg font-semibold">열람 권한이 없습니다</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          {requiredRole ? (
            <>
              이 글은 <strong className="text-fg">{ROLE_LABEL[requiredRole]}</strong> 등급 이상만
              볼 수 있습니다.
            </>
          ) : (
            '이 글을 볼 수 있는 등급이 아닙니다.'
          )}
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
  const { boardId = '', postId = '' } = useParams()
  const { data: post, isPending, error } = usePost(postId)

  if (isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      const detail = error.body as { requiredRole?: Role } | undefined
      return <Forbidden requiredRole={detail?.requiredRole} />
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
      <Link
        to={`/board/${boardId}`}
        className="text-muted hover:text-fg mb-4 inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" />
        목록
      </Link>

      <Card className="p-6">
        <h1 className="text-fg flex items-start gap-2 text-xl font-semibold">
          {post.pinned && <Pin className="text-accent mt-1 size-4 shrink-0" />}
          {post.title}
        </h1>

        <div className="text-subtle mt-3 flex items-center gap-2 text-xs">
          <Avatar name={post.authorName} hue={200} size="sm" />
          {post.authorName}
          <span>·</span>
          {formatRelative(post.createdAt)}
        </div>

        <div className="border-line mt-5 border-t pt-5">
          <p className="text-fg text-[15px] leading-7 whitespace-pre-wrap">{post.body}</p>
        </div>
      </Card>
    </>
  )
}
