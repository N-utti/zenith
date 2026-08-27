import { Link } from 'react-router'
import { FileText } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatRelative } from '@/lib/datetime'
import { useRecentDocs } from './api'

export function RecentDocsCard() {
  const { data, isPending, isError } = useRecentDocs()

  return (
    <Card>
      <CardHeader title="최근 문서" to="/docs" />

      {isPending && <SkeletonRows />}
      {isError && <CardEmpty>문서를 불러오지 못했습니다.</CardEmpty>}

      {data &&
        (data.items.length === 0 ? (
          <CardEmpty>최근 본 문서가 없습니다.</CardEmpty>
        ) : (
          <ul className="px-2 pb-2">
            {data.items.map((doc) => (
              <li key={doc.id}>
                <Link
                  to={`/docs/${doc.id}`}
                  className="hover:bg-surface-hover flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                >
                  <FileText className="text-subtle size-4 shrink-0" />
                  <span className="text-fg min-w-0 flex-1 truncate text-sm">{doc.title}</span>
                  <Avatar name={doc.editorName} hue={doc.editorHue} size="sm" />
                  <span className="text-subtle w-14 shrink-0 text-right text-xs">
                    {formatRelative(doc.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  )
}
