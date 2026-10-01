import { useState } from 'react'
import { Link } from 'react-router'
import { Paperclip, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/ToastContext'
import { downloadPath, useArchive } from '@/features/archive/api'
import { ARCHIVE_LIMIT, type ArchiveFile, type ArchiveSource } from '@/features/archive/types'
import { ApiError } from '@/lib/api'
import { formatRelative } from '@/lib/datetime'
import { downloadFromApi } from '@/lib/download'
import { cleanName, formatBytes, splitExt } from '@/lib/format'

const COLUMNS = 6

const SOURCE_LABEL: Record<ArchiveSource, string> = { chat: '채팅', doc: '문서' }

const SOURCE_TABS = [
  { key: 'all', label: '전체' },
  { key: 'chat', label: SOURCE_LABEL.chat },
  { key: 'doc', label: SOURCE_LABEL.doc },
]

/** 맥·아이폰은 한글 이름을 자모로 풀어 올린다. 붙여 쓴 검색어와 맞도록 양쪽을 같은 꼴로 맞춘다. */
const fold = (text: string) => text.normalize('NFC').toLowerCase()

/**
 * 자료실. 채팅과 문서에 붙인 파일을 한곳에 모아 찾고 내려받는다.
 *
 * 파일은 원래 자리에 그대로 있다. 여기서 옮기거나 지우지 않는다. 열람 범위도 원래 자리를 따른다.
 * 서버가 내가 받을 수 있는 파일만 주고, 화면은 준 대로 그린다.
 */
export function ArchivePage() {
  const { data, isPending, isError, refetch } = useArchive()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  // 받는 동안 모든 줄을 잠근다. 연달아 누르면 같은 파일을 여러 번 받는다.
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // ponytail: 받아 온 줄 안에서만 거른다. 상한을 넘기는 날이 오면 서버 쪽 검색(q)과 다음 쪽으로.
  const all = data?.items ?? []
  const q = fold(query.trim())
  const items = all.filter(
    (file) => (source === 'all' || file.source === source) && fold(file.name).includes(q),
  )

  const download = async (file: ArchiveFile, name: string) => {
    const path = downloadPath(file.url)
    if (!path) return toast.error('내려받을 수 없는 주소입니다.')
    setBusy(true)
    try {
      await downloadFromApi(path, name)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : '파일을 내려받지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="자료실"
        description="채팅과 문서에 붙인 파일을 한곳에서 찾습니다. 내가 볼 수 있는 파일만 보입니다."
      />

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="파일 검색"
        placeholder="파일 이름으로 검색"
        icon={<Search className="size-4" />}
        className="mb-2 max-w-md"
      />

      <Tabs items={SOURCE_TABS} value={source} onChange={setSource}>
        {() => (
          <>
            {isPending && <SkeletonRows rows={5} />}
            {isError && !data && (
              <Card>
                <CardEmpty onRetry={refetch}>자료실을 불러오지 못했습니다.</CardEmpty>
              </Card>
            )}

            {data && (
              <Table label="자료실 파일 목록">
                <THead>
                  <TR>
                    <TH>이름</TH>
                    <TH className="hidden w-20 md:table-cell">크기</TH>
                    <TH className="w-28 sm:w-44">붙은 곳</TH>
                    <TH className="hidden w-24 md:table-cell">올린 사람</TH>
                    <TH className="hidden w-24 sm:table-cell">올린 때</TH>
                    <TH className="w-20">열람</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.length === 0 && (
                    <TableEmpty colSpan={COLUMNS}>
                      {q
                        ? `"${query.trim()}"와 일치하는 파일이 없습니다.`
                        : source === 'all'
                          ? '아직 모인 파일이 없습니다. 채팅이나 문서에 파일을 붙이면 여기 모입니다.'
                          : `${SOURCE_LABEL[source as ArchiveSource]}에 붙은 파일이 없습니다.`}
                    </TableEmpty>
                  )}
                  {items.map((file) => {
                    const name = cleanName(file.name) || '파일'
                    const [stem, ext] = splitExt(name)
                    return (
                      // 같은 첨부 주소를 두 메시지가 실을 수 있다. 시각까지 붙여야 줄이 겹치지 않는다.
                      <TR key={`${file.url} ${file.created_at}`}>
                        {/* 칸을 0으로 눕혀야 긴 이름이 표를 가로로 굴리지 않는다(휴지통과 같은 관용구). */}
                        <TD className="max-w-0">
                          <button
                            type="button"
                            title={name}
                            aria-label={`${name} 내려받기`}
                            disabled={busy}
                            onClick={() => void download(file, name)}
                            className="hover:text-accent flex max-w-full cursor-pointer items-center gap-2 py-1 text-left font-medium transition-colors disabled:cursor-default disabled:opacity-60"
                          >
                            <Paperclip className="text-subtle size-4 shrink-0" />
                            <span className="flex min-w-0">
                              <span className="truncate">{stem}</span>
                              <span className="shrink-0">{ext}</span>
                            </span>
                          </button>
                        </TD>
                        <TD className="text-muted hidden whitespace-nowrap md:table-cell">
                          {formatBytes(file.size)}
                        </TD>
                        <TD className="max-w-0">
                          <Link
                            to={`/${file.source === 'chat' ? 'chat' : 'docs'}/${file.source_id}`}
                            className="text-muted hover:text-fg block truncate"
                          >
                            {SOURCE_LABEL[file.source]} · {file.source_title}
                          </Link>
                        </TD>
                        <TD className="text-muted hidden whitespace-nowrap md:table-cell">
                          {file.uploaded_by?.name ?? '알 수 없음'}
                        </TD>
                        <TD className="text-muted hidden whitespace-nowrap sm:table-cell">
                          {formatRelative(file.created_at)}
                        </TD>
                        <TD>
                          <Badge tone={file.scope === 'members' ? 'accent' : 'neutral'}>
                            {file.scope === 'members' ? '멤버만' : '전체'}
                          </Badge>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}

            {all.length >= ARCHIVE_LIMIT && (
              <p className="text-subtle mt-3 text-xs">
                최근 {ARCHIVE_LIMIT}개까지만 보입니다. 더 오래된 파일은 붙은 곳에서 찾아 주세요.
              </p>
            )}
          </>
        )}
      </Tabs>
    </>
  )
}
