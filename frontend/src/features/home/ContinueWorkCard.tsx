import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { formatRelative } from '@/lib/datetime'
import { HomeSection } from './HomeSection'
import { useRecentDocs } from './api'

/** 본문 미리보기가 아직 없어 표지 자리를 줄무늬로 채운다. */
const THUMBNAIL =
  'repeating-linear-gradient(45deg, var(--zenith-sunken), var(--zenith-sunken) 8px, var(--zenith-surface-hover) 8px, var(--zenith-surface-hover) 16px)'

/** 카드는 넉 장만. 서버는 여덟 개까지 주지만 홈 한 화면의 밀도가 정해져 있다(12 UI 청사진). */
const RECENT_LIMIT = 4

export function ContinueWorkCard({
  onCreate,
  creating,
  createDisabled,
}: {
  /** 새 문서 만들기. 홈 헤더의 「새 문서」 버튼과 같은 동작을 쓴다(`HomePage`). */
  onCreate: () => void
  creating: boolean
  createDisabled: boolean
}) {
  const { data, isPending, isError, refetch } = useRecentDocs()

  return (
    <HomeSection title="이어서 작업" to="/docs">
      {isPending && (
        <div className="flex gap-3.5 overflow-x-auto lg:grid lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-line bg-surface h-[136px] w-[150px] shrink-0 animate-pulse rounded-xl border lg:w-auto"
            />
          ))}
        </div>
      )}

      {isError && !data && (
        <Card>
          <CardEmpty onRetry={refetch}>문서를 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data &&
        (data.length === 0 ? (
          <Card>
            <CardEmpty
              action={
                <Button size="sm" onClick={onCreate} disabled={createDisabled}>
                  {creating ? (
                    <Spinner className="border-t-on-accent" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  새 문서
                </Button>
              }
            >
              최근 편집한 문서가 없습니다.
            </CardEmpty>
          </Card>
        ) : (
          <div className="flex gap-3.5 overflow-x-auto lg:grid lg:grid-cols-2">
            {data.slice(0, RECENT_LIMIT).map((doc) => (
              <Link
                key={doc.id}
                to={`/docs/${doc.id}`}
                className="border-line bg-surface hover:border-line-strong w-[150px] shrink-0 rounded-xl border p-3.5 transition-colors lg:w-auto"
              >
                <div className="h-[70px] rounded-md" style={{ background: THUMBNAIL }} />
                <p className="text-fg mt-2.5 truncate text-[13.5px] font-semibold">{doc.title}</p>
                {doc.path.length > 0 && (
                  <p className="text-subtle mt-1 truncate text-[11px]">{doc.path.join(' / ')}</p>
                )}
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
