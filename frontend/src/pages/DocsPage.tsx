import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FileText, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { hueOf } from '@/lib/avatar'
import { formatRelative } from '@/lib/datetime'
import { useCreateDoc, useTree } from '@/features/docs/api'
import { byRecent, defaultFolderId } from '@/features/docs/tree'

/**
 * 문서 목록. 사이드바 폴더 이름을 누르면 `?folder=` 가 붙어 그 폴더 문서만 보인다.
 *
 * 폴더가 바뀌면 검색어를 비운다. 같은 라우트라 다시 마운트되지 않아서 key 로 끊는다.
 */
export function DocsPage() {
  const folderId = useSearchParams()[0].get('folder')
  return <DocsList key={folderId ?? ''} folderId={folderId} />
}

function DocsList({ folderId }: { folderId: string | null }) {
  const [query, setQuery] = useState('')
  // 실서버에는 문서 목록 API(`GET /docs`)가 없다. 사이드바가 받는 트리에 문서 메타가 다 있어 거른다.
  const { data, isPending, isError, refetch } = useTree()
  const createDoc = useCreateDoc()
  const navigate = useNavigate()
  const toast = useToast()

  const folder = folderId ? data?.folders.find((f) => f.id === folderId) : undefined
  /** 폴더를 열었는데 트리에 없다. 지워졌거나 낡은 링크다. */
  const missing = Boolean(folderId && data && !folder)
  // 문서는 폴더 안에만 생긴다. 폴더를 열지 않았으면 고를 자리가 없어 최상위 첫 폴더에 넣는다.
  const targetId = folderId ? folder?.id : data && defaultFolderId(data)
  const targetName = data?.folders.find((f) => f.id === targetId)?.title

  // ponytail: 트리가 문서 메타를 전부 들고 있어 거르기만 한다. 수천 개가 되면 서버 쪽 목록 API 로.
  const docs = useMemo(
    () =>
      (data?.docs ?? [])
        .filter((d) => !d.deleted_at && (!folderId || d.folder_id === folderId))
        .sort(byRecent),
    [data, folderId],
  )
  const q = query.trim().toLowerCase()
  const items = q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs

  const create = () => {
    if (!targetId) return
    createDoc.mutate(
      { folder_id: targetId },
      {
        onSuccess: (doc) => {
          // 폴더를 안 열었으면 어느 폴더에 들어갔는지 여기서만 알 수 있다.
          if (!folderId && targetName) toast.success(`${targetName} 폴더에 만들었습니다.`)
          void navigate(`/docs/${doc.id}`)
        },
      },
    )
  }

  const createButton = (
    <Button
      size="sm"
      onClick={create}
      disabled={createDoc.isPending || isPending || !targetId}
      title={targetId || isPending ? undefined : '먼저 사이드바에서 폴더를 만들어 주세요.'}
    >
      {createDoc.isPending ? (
        <Spinner className="border-t-on-accent" />
      ) : (
        <Plus className="size-4" />
      )}
      새 문서
    </Button>
  )

  return (
    <>
      <PageHeader
        title={folderId ? (folder?.title ?? (missing ? '폴더' : '')) : '문서'}
        description={
          folderId
            ? folder && `문서 ${docs.length}개 · 최근 수정순`
            : '사내 위키와 회의록. 여러 명이 동시에 편집할 수 있습니다.'
        }
        actions={
          <>
            <Link to="/docs/trash" className="text-subtle hover:text-fg mr-1 text-sm">
              휴지통
            </Link>
            {!missing && createButton}
          </>
        }
      />

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="문서 검색"
        placeholder="제목으로 검색"
        icon={<Search className="size-4" />}
        className="mb-4 max-w-md"
      />

      <Card>
        {isPending && <SkeletonRows rows={5} />}
        {isError && !data && <CardEmpty onRetry={refetch}>문서를 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (missing ? (
            <CardEmpty
              action={
                <Link to="/docs" className="text-accent text-sm">
                  전체 문서 보기
                </Link>
              }
            >
              폴더를 찾을 수 없습니다. 지워졌거나 옮겨졌을 수 있습니다.
            </CardEmpty>
          ) : items.length === 0 ? (
            <CardEmpty action={!query && createButton}>
              {query ? `"${query}"와 일치하는 문서가 없습니다.` : '아직 문서가 없습니다.'}
            </CardEmpty>
          ) : (
            <ul className="p-2">
              {items.map((doc) => (
                <li key={doc.id}>
                  <Link
                    to={`/docs/${doc.id}`}
                    className="hover:bg-surface-hover flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                  >
                    <FileText className="text-subtle size-4 shrink-0" />
                    <span className="text-fg min-w-0 flex-1 truncate text-sm font-medium">
                      {doc.title}
                    </span>
                    <Avatar
                      name={doc.updated_by?.name ?? '?'}
                      hue={hueOf(doc.updated_by?.id ?? '')}
                      size="sm"
                    />
                    <span className="text-subtle w-16 shrink-0 text-right text-xs">
                      {formatRelative(doc.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </>
  )
}
