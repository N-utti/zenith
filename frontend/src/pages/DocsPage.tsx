import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FileText, Folder, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { formatRelative } from '@/lib/datetime'
import { useCreateDoc, useTree } from '@/features/docs/api'
import { NewDocModal } from '@/features/docs/NewDocModal'
import {
  buildTree,
  byRecent,
  findFolder,
  folderSummary,
  type FolderNode,
} from '@/features/docs/tree'

/**
 * 문서 목록. 사이드바 폴더 이름을 누르면 `?folder=` 가 붙어 그 폴더의 하위 폴더와 문서만 보인다.
 * 폴더를 안 열었을 때는 모든 문서를 최근 수정순으로 편다(폴더는 사이드바가 보여 준다).
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
  const [picking, setPicking] = useState(false)

  const folder = folderId ? data?.folders.find((f) => f.id === folderId) : undefined
  /** 폴더를 열었는데 트리에 없다. 지워졌거나 낡은 링크다. */
  const missing = Boolean(folderId && data && !folder)

  // ponytail: 트리가 문서 메타를 전부 들고 있어 거르기만 한다. 수천 개가 되면 서버 쪽 목록 API 로.
  const docs = useMemo(
    () =>
      (data?.docs ?? [])
        .filter((d) => !d.deleted_at && (!folderId || d.folder_id === folderId))
        .sort(byRecent),
    [data, folderId],
  )
  // 폴더를 열었을 때만 하위 폴더를 문서 위에 둔다. 사이드바가 그리는 트리 그대로라 순서가 같다.
  const subfolders = useMemo(() => {
    if (!folderId || !data) return []
    const node = findFolder(buildTree(data), folderId)
    return node ? node.children.filter((c): c is FolderNode => c.kind === 'folder') : []
  }, [data, folderId])
  const q = query.trim().toLowerCase()
  const items = q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs
  const folderItems = q
    ? subfolders.filter((n) => n.folder.title.toLowerCase().includes(q))
    : subfolders

  // 폴더를 열어 두었으면 거기에 바로 만든다. 아니면 넣을 폴더를 먼저 고른다.
  const create = () => {
    if (!folder) return setPicking(true)
    createDoc.mutate(
      { folder_id: folder.id },
      {
        onSuccess: (doc) => void navigate(`/docs/${doc.id}`),
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : '문서를 만들지 못했습니다.'),
      },
    )
  }

  const createButton = (
    <Button
      size="sm"
      onClick={create}
      disabled={createDoc.isPending || (Boolean(folderId) && !folder)}
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
            ? folder &&
              `${subfolders.length ? `폴더 ${subfolders.length}개 · ` : ''}문서 ${docs.length}개 · 최근 수정순`
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
          ) : items.length === 0 && folderItems.length === 0 ? (
            <CardEmpty action={!query && createButton}>
              {query
                ? `"${query}"와 일치하는 ${folderId ? '폴더나 문서가' : '문서가'} 없습니다.`
                : '아직 문서가 없습니다.'}
            </CardEmpty>
          ) : (
            <ul className="p-2">
              {folderItems.map((sub) => (
                <li key={sub.folder.id}>
                  <Link
                    to={`/docs?folder=${sub.folder.id}`}
                    className="hover:bg-surface-hover flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                  >
                    <Folder className="text-subtle size-4 shrink-0" />
                    <span className="text-fg min-w-0 flex-1 truncate text-sm font-medium">
                      {/* 아이콘은 낭독기가 건너뛴다. 문서 줄과 구별되게 「폴더」를 읽어 준다. */}
                      <span className="sr-only">폴더 </span>
                      {sub.folder.title}
                    </span>
                    {/* 문서 줄의 아바타·시각 자리. 폴더엔 그게 없으니 든 것의 수를 둔다. */}
                    <span className="text-subtle shrink-0 text-xs">{folderSummary(sub)}</span>
                  </Link>
                </li>
              ))}
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

      {picking && <NewDocModal onClose={() => setPicking(false)} />}
    </>
  )
}
