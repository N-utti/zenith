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
import { formatRelative } from '@/lib/datetime'
import { useCreateDoc, useDocs } from '@/features/docs/api'

export function DocsPage() {
  const [query, setQuery] = useState('')
  const { data, isPending, isError } = useDocs(query)
  const createDoc = useCreateDoc()
  const navigate = useNavigate()

  const create = () => {
    createDoc.mutate(undefined, {
      onSuccess: (doc) => void navigate(`/docs/${doc.id}`),
    })
  }

  return (
    <>
      <PageHeader
        title="문서"
        description="사내 위키와 회의록. 여러 명이 동시에 편집할 수 있습니다."
        actions={
          <Button size="sm" onClick={create} disabled={createDoc.isPending}>
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
                    <Avatar name={doc.editorName} hue={doc.editorHue} size="sm" />
                    <span className="text-subtle w-16 shrink-0 text-right text-xs">
                      {formatRelative(doc.updatedAt)}
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
