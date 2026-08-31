import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatRelative } from '@/lib/datetime'
import { HomeSection } from './HomeSection'
import { useMentions } from './api'
import type { Mention } from './types'

function sourceLink(source: Mention['source']): string {
  return source.kind === 'doc' ? `/docs/${source.docId}` : `/chat/${source.channelId}`
}

function sourceLabel(source: Mention['source']): string {
  return source.kind === 'doc' ? source.docTitle : `#${source.channelName}`
}

export function MentionsCard() {
  const { data, isPending, isError } = useMentions()

  return (
    <HomeSection title="나에게 온 멘션 & 댓글" to="/notifications">
      <Card>
        {isPending && <SkeletonRows />}
        {isError && <CardEmpty>알림을 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (data.items.length === 0 ? (
            <CardEmpty>새 멘션이 없습니다.</CardEmpty>
          ) : (
            <ul>
              {data.items.map((mention, index) => (
                <li key={mention.id}>
                  <Link
                    to={sourceLink(mention.source)}
                    className={
                      'hover:bg-surface-hover flex gap-3 px-4 py-3.5 transition-colors' +
                      (index > 0 ? ' border-line border-t' : '')
                    }
                  >
                    <Avatar name={mention.actorName} hue={mention.actorHue} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-fg text-[13px] leading-relaxed">
                        <span className="font-semibold">{mention.actorName}</span>님이{' '}
                        {mention.mentionsMe && (
                          <span className="bg-accent-soft text-accent rounded px-1 py-0.5 text-[12px] font-medium">
                            @나
                          </span>
                        )}{' '}
                        {mention.body}
                      </p>
                      <p className="text-subtle mt-1 truncate text-[11px]">
                        {sourceLabel(mention.source)} · {mention.source.via} ·{' '}
                        {formatRelative(mention.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </HomeSection>
  )
}
