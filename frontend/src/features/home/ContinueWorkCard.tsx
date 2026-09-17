import { Link } from 'react-router'
import { Card, CardEmpty } from '@/components/ui/Card'
import { formatRelative } from '@/lib/datetime'
import { HomeSection } from './HomeSection'
import { useRecentDocs } from './api'

/** 본문 미리보기가 아직 없어 표지 자리를 줄무늬로 채운다. */
const THUMBNAIL =
  'repeating-linear-gradient(45deg, var(--zenith-sunken), var(--zenith-sunken) 8px, var(--zenith-surface-hover) 8px, var(--zenith-surface-hover) 16px)'

export function ContinueWorkCard() {
  const { data, isPending, isError } = useRecentDocs()

  return (
    <HomeSection title="이어서 작업" to="/docs">
      {isPending && (
        <div className="grid grid-cols-2 gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-line bg-surface h-[136px] animate-pulse rounded-xl border" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardEmpty>문서를 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data &&
        (data.length === 0 ? (
          <Card>
            <CardEmpty>최근 편집한 문서가 없습니다.</CardEmpty>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3.5">
            {data.map((doc) => (
              <Link
                key={doc.id}
                to={`/docs/${doc.id}`}
                className="border-line bg-surface hover:border-line-strong rounded-xl border p-3.5 transition-colors"
              >
                <div className="h-[70px] rounded-md" style={{ background: THUMBNAIL }} />
                <p className="text-fg mt-2.5 truncate text-[13.5px] font-semibold">{doc.title}</p>
                <p className="text-subtle mt-1 truncate text-[11px]">
                  {doc.updated_by?.name ?? '알 수 없음'} · {formatRelative(doc.updated_at)}
                </p>
              </Link>
            ))}
          </div>
        ))}
    </HomeSection>
  )
}
