import { Link } from 'react-router'
import { Pin } from 'lucide-react'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatRelative } from '@/lib/datetime'
import { ROLE_LABEL } from '@/types'
import { useAnnouncements } from './api'

export function AnnouncementsCard() {
  const { data, isPending, isError } = useAnnouncements()

  return (
    <Card>
      <CardHeader title="공지" to="/board" />

      {isPending && <SkeletonRows />}
      {isError && <CardEmpty>공지를 불러오지 못했습니다.</CardEmpty>}

      {data &&
        (data.items.length === 0 ? (
          <CardEmpty>새 공지가 없습니다.</CardEmpty>
        ) : (
          <ul className="px-2 pb-2">
            {data.items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/board/${item.id}`}
                  className="hover:bg-surface-hover block rounded-lg px-3 py-2 transition-colors"
                >
                  <p className="text-fg flex items-center gap-1.5 text-sm">
                    {item.pinned && <Pin className="text-accent size-3.5 shrink-0" />}
                    <span className="truncate">{item.title}</span>
                    {/* 전사 공지가 아니면 어느 등급 게시판 글인지 밝힌다. */}
                    {item.boardLevel !== 'member' && (
                      <Badge tone="accent">{ROLE_LABEL[item.boardLevel]}</Badge>
                    )}
                  </p>
                  <p className="text-subtle mt-0.5 text-xs">
                    {item.authorName} · {formatRelative(item.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  )
}
