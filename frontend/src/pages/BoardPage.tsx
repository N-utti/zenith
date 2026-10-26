import { useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { Pin, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MaskedNote, MaskedRow } from '@/components/ui/MaskedRow'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { formatRelative } from '@/lib/datetime'
import { PostComposer } from '@/features/board/PostComposer'
import { useBoards, usePosts } from '@/features/board/api'
import { BOARD_BADGE } from '@/features/board/types'

export function BoardPage() {
  const { boardId } = useParams()
  const { data: boards, isPending: boardsPending } = useBoards()
  const [composing, setComposing] = useState(false)

  // /board 로 들어오면 첫 게시판(전체 공지)으로 보낸다. 사이드바가 게시판을 나열하므로
  // 통합 목록 화면을 따로 두지 않는다 (05 SCR-05는 게시판 화면 하나만 정의한다).
  // id 는 서버가 정한다(실서버는 UUID). 서버가 전체 공지를 맨 앞에 정렬해 준다.
  if (!boardId && boardsPending) return <SkeletonRows rows={5} />
  const first = boards?.items[0]
  if (!boardId && first) return <Navigate to={`/board/${first.id}`} replace />

  const board = boards?.items.find((b) => b.id === boardId)

  if (!boardId || (!boardsPending && !board)) {
    return <PageHeader title="게시판을 찾을 수 없습니다" description="주소를 다시 확인해 주세요." />
  }

  return (
    <>
      <PageHeader
        title={board?.name ?? '게시판'}
        description={
          board?.allowed
            ? `${BOARD_BADGE[board.min_role]} 등급 게시판`
            : '열람 권한이 없는 게시판입니다. 글이 있다는 것만 보이고 제목과 본문은 가려집니다.'
        }
        actions={
          // FR-BRD-02. 열람할 수 있는 게시판에만 글쓰기 버튼이 보인다.
          board?.allowed && (
            <Button size="sm" onClick={() => setComposing(true)}>
              <Plus className="size-4" />
              글쓰기
            </Button>
          )
        }
      />

      <PostTable boardId={boardId} badge={board ? BOARD_BADGE[board.min_role] : ''} />

      {board?.allowed && composing && (
        <PostComposer board={board} onClose={() => setComposing(false)} />
      )}
    </>
  )
}

function PostTable({ boardId, badge }: { boardId: string; badge: string }) {
  const { data, isPending, isError } = usePosts(boardId)

  if (isPending) return <SkeletonRows rows={5} />
  if (isError) {
    return <p className="text-subtle py-10 text-center text-sm">글을 불러오지 못했습니다.</p>
  }

  return (
    <Table label="게시글 목록">
      <THead>
        <TR>
          <TH className="w-full">제목</TH>
          {/* 좁은 화면에서는 부가 열을 접는다. 4열을 유지하면 제목이 서너 줄로 쪼개져
              목록으로 못 쓴다. 접은 값은 제목 아래 메타 줄로 내려간다. */}
          <TH className="hidden whitespace-nowrap md:table-cell">등급</TH>
          <TH className="hidden whitespace-nowrap md:table-cell">작성</TH>
          <TH className="hidden whitespace-nowrap md:table-cell">시각</TH>
        </TR>
      </THead>
      <TBody>
        {data.items.length === 0 ? (
          <TableEmpty colSpan={4}>아직 글이 없습니다. 첫 글을 올려 보세요.</TableEmpty>
        ) : (
          data.items.map((post) => (
            // 흐림은 행(TR muted) 한 번만. MaskedRow 도 55%를 걸어 겹치면 약 30%가 되므로
            // 제목 칸 쪽은 opacity-100 으로 되돌린다(12 §7: 권한 밖 행 55% 한 번).
            <TR key={post.id} muted={post.masked}>
              <TD>
                {/* 마스킹된 행은 링크가 아니다. 클릭해도 갈 곳이 없어야 한다. */}
                <MaskedRow
                  masked={post.masked}
                  to={post.masked ? undefined : `/board/${boardId}/${post.id}`}
                  className="flex items-center gap-1.5 rounded-md opacity-100"
                >
                  {post.pinned && <Pin className="text-accent size-3.5 shrink-0" />}
                  <span className={post.masked ? 'text-subtle' : 'text-fg font-medium'}>
                    {post.title}
                  </span>
                </MaskedRow>
                <p className="text-subtle mt-1 text-xs md:hidden">
                  {post.masked ? <MaskedNote /> : (post.author?.name ?? '알 수 없음')} ·{' '}
                  {formatRelative(post.created_at)}
                </p>
              </TD>
              {/* 게시판별 화면이라 모든 행이 같은 등급이다. 05 SCR-05가 목록 요소로
                  요구하므로 두되, 값은 게시판 등급을 그대로 쓴다. */}
              <TD className="hidden whitespace-nowrap md:table-cell">
                <Badge>{badge}</Badge>
              </TD>
              <TD className="text-muted hidden whitespace-nowrap md:table-cell">
                {post.masked ? <MaskedNote /> : (post.author?.name ?? '알 수 없음')}
              </TD>
              <TD className="text-subtle hidden whitespace-nowrap text-xs md:table-cell">
                {formatRelative(post.created_at)}
              </TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  )
}
