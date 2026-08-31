import { Link } from 'react-router'
import { Pin } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatRelative } from '@/lib/datetime'
import { ROLE_LABEL } from '@/types'
import { HomeSection } from './HomeSection'
import { useAnnouncements } from './api'

const ROW = 'block px-4 py-3.5'

export function AnnouncementsCard() {
  const { data, isPending, isError } = useAnnouncements()

  return (
    <HomeSection title="공지 게시판" to="/board">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && <CardEmpty>공지를 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (data.items.length === 0 ? (
            <CardEmpty>새 공지가 없습니다.</CardEmpty>
          ) : (
            <ul>
              {data.items.map((item, index) => {
                const divider = index > 0 ? 'border-line border-t' : ''

                const inner = (
                  <>
                    <p className="flex items-center gap-1.5">
                      {item.pinned && !item.masked && (
                        <Pin className="text-accent size-3.5 shrink-0" />
                      )}
                      <span
                        className={cn(
                          'truncate text-[13px] font-semibold',
                          item.masked ? 'text-subtle' : 'text-fg',
                        )}
                      >
                        {item.title}
                      </span>
                      <Badge className="ml-auto shrink-0">
                        {item.boardLevel === 'member' ? '전체' : `${ROLE_LABEL[item.boardLevel]}↑`}
                      </Badge>
                    </p>
                    <p className="text-subtle mt-1 text-[11px]">
                      {item.masked
                        ? '열람 권한 없음'
                        : `${item.authorName} · ${formatRelative(item.createdAt)}`}
                    </p>
                  </>
                )

                // 권한 밖 글은 자리만 남기고 링크를 걸지 않는다 — 본문은 서버가 403으로 막는다.
                return (
                  <li key={item.id}>
                    {item.masked ? (
                      <div
                        aria-disabled
                        className={cn(ROW, divider, 'cursor-not-allowed opacity-55')}
                      >
                        {inner}
                      </div>
                    ) : (
                      <Link
                        to={`/board/${item.id}`}
                        className={cn(ROW, divider, 'hover:bg-surface-hover transition-colors')}
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
