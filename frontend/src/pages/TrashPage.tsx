import { Link } from 'react-router'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { usePurgeDoc, useTrash, useUntrashDoc } from '@/features/docs/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { daysUntil, formatRelative } from '@/lib/datetime'
import { ROLE_RANK } from '@/types'

/** 서버가 휴지통 문서를 들고 있는 기간. 지나면 서버가 스스로 영구 삭제한다. */
const KEEP_DAYS = 30

const COLUMNS = 5

/** 휴지통에 들어간 시각으로 영구 삭제까지 남은 날을 센다. */
function daysLeft(deletedAt: string): number {
  const due = new Date(deletedAt)
  due.setDate(due.getDate() + KEEP_DAYS)
  return daysUntil(due.toISOString())
}

/**
 * 휴지통. 지운 문서를 되돌리거나(누구나) 지금 영구 삭제한다(임원만).
 *
 * 지우기 직후의 토스트를 놓쳤을 때 되돌릴 수 있는 유일한 자리다.
 */
export function TrashPage() {
  const me = useCurrentUser()
  const { data, isPending, isError } = useTrash()
  const untrash = useUntrashDoc()
  const purge = usePurgeDoc()
  const toast = useToast()
  // 영구 삭제는 임원만. 화면은 버튼을 감출 뿐이고 실제 차단은 서버의 403 이다.
  const isExec = ROLE_RANK[me.role] >= ROLE_RANK.exec
  const busy = untrash.isPending || purge.isPending

  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  return (
    <>
      <PageHeader
        title="휴지통"
        description={`지운 문서는 ${KEEP_DAYS}일 동안 여기 있다가 서버가 영구 삭제합니다.`}
        actions={
          <Link to="/docs" className="text-subtle hover:text-fg text-sm">
            문서로
          </Link>
        }
      />

      {isPending && <SkeletonRows rows={4} />}
      {isError && (
        <Card>
          <CardEmpty>휴지통을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <Table>
          <THead>
            <TR>
              <TH>제목</TH>
              <TH className="w-28">지운 사람</TH>
              <TH className="w-24">지운 때</TH>
              <TH className="w-28">영구 삭제까지</TH>
              <TH className="w-40 text-right">되돌리기</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.length === 0 && (
              <TableEmpty colSpan={COLUMNS}>휴지통이 비었습니다.</TableEmpty>
            )}
            {data.items.map((doc) => {
              const title = doc.title || '제목 없는 문서'
              const left = doc.deleted_at ? daysLeft(doc.deleted_at) : KEEP_DAYS
              return (
                <TR key={doc.id}>
                  <TD>
                    {/* 휴지통 문서도 열어서 읽을 수는 있다. 서버가 읽기만 열어 둔다. */}
                    <Link to={`/docs/${doc.id}`} className="hover:text-accent truncate font-medium">
                      {title}
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-2">
                      <Avatar
                        name={doc.updated_by?.name ?? '?'}
                        hue={hueOf(doc.updated_by?.id ?? '')}
                        size="sm"
                      />
                      <span className="text-muted truncate text-xs">
                        {doc.updated_by?.name ?? '알 수 없음'}
                      </span>
                    </span>
                  </TD>
                  <TD className="text-muted whitespace-nowrap">
                    {doc.deleted_at ? formatRelative(doc.deleted_at) : '-'}
                  </TD>
                  <TD className={left <= 3 ? 'text-danger' : 'text-muted'}>
                    {left === 0 ? '오늘' : `${left}일`}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`${title} 되돌리기`}
                      disabled={busy}
                      onClick={() =>
                        untrash.mutate(doc.id, {
                          onSuccess: () => toast.success(`${title} 를 되돌렸습니다.`),
                          onError: fail('되돌리지 못했습니다.'),
                        })
                      }
                    >
                      {untrash.isPending && untrash.variables === doc.id ? (
                        <Spinner />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      되돌리기
                    </Button>
                    {isExec && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${title} 영구 삭제`}
                        className="hover:text-danger ml-1"
                        disabled={busy}
                        onClick={() => {
                          // 되돌릴 수 없다. 버전·댓글까지 같이 사라진다.
                          if (!confirm(`${title} 를 영구 삭제할까요? 되돌릴 수 없습니다.`)) return
                          purge.mutate(doc.id, {
                            onSuccess: () => toast.success('영구 삭제했습니다.'),
                            onError: fail('영구 삭제하지 못했습니다.'),
                          })
                        }}
                      >
                        {purge.isPending && purge.variables === doc.id ? (
                          <Spinner />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}
    </>
  )
}
