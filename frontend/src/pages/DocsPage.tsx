import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
import { useCreateDoc, useDefaultFolder, useDocs } from '@/features/docs/api'

export function DocsPage() {
  const [query, setQuery] = useState('')
  const { data, isPending, isError } = useDocs(query)
  const createDoc = useCreateDoc()
  // 문서는 폴더 안에만 생긴다. 여기서는 고를 자리가 없어 최상위 첫 폴더에 넣는다.
  const { folderId, folderName, isPending: treePending } = useDefaultFolder()
  const navigate = useNavigate()
  const toast = useToast()

  const create = () => {
    if (!folderId) return
    createDoc.mutate(
      { folder_id: folderId },
      {
        onSuccess: (doc) => {
          // 어느 폴더에 들어갔는지는 여기서만 알 수 있다. 고를 자리가 없었기 때문이다.
          if (folderName) toast.success(`${folderName} 폴더에 만들었습니다.`)
          void navigate(`/docs/${doc.id}`)
        },
      },
    )
  }

  return (
    <>
      <PageHeader
        title="문서"
        description="사내 위키와 회의록. 여러 명이 동시에 편집할 수 있습니다."
        actions={
          <Button
            size="sm"
            onClick={create}
            disabled={createDoc.isPending || treePending || !folderId}
            title={
              folderId || treePending ? undefined : '먼저 사이드바에서 폴더를 만들어 주세요.'
            }
          >
            {createDoc.isPending ? (
              <Spinner className="border-t-on-accent" />
            ) : (
              <Plus className="size-4" />
            )}
            새 문서
          </Button>
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
        {isError && <CardEmpty>문서를 불러오지 못했습니다.</CardEmpty>}

        {data &&
          (data.items.length === 0 ? (
            <CardEmpty>
              {query ? `"${query}"와 일치하는 문서가 없습니다.` : '아직 문서가 없습니다.'}
            </CardEmpty>
          ) : (
            <ul className="p-2">
              {data.items.map((doc) => (
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
