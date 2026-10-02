import { useState } from 'react'
import { Link } from 'react-router'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { UNTITLED_DOC, usePurgeDoc, useTrash, useUntrashDoc } from '@/features/docs/api'
import { purgeAt, TRASH_KEEP_DAYS } from '@/features/docs/types'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { daysUntil, formatRelative } from '@/lib/datetime'
import { ROLE_RANK } from '@/types'

const COLUMNS = 5

/**
 * 휴지통. 지운 문서를 되돌리거나(누구나) 지금 영구 삭제한다(임원만).
 *
 * 지우기 직후의 토스트를 놓친 뒤 되돌리는 상시 경로다.
 */
export function TrashPage() {
  const me = useCurrentUser()
  const { data, isPending, isError, refetch } = useTrash()
  const untrash = useUntrashDoc()
  const purge = usePurgeDoc()
  const toast = useToast()
  // 영구 삭제는 임원만. 화면은 버튼을 감출 뿐이고 실제 차단은 서버의 403 이다.
  const isExec = ROLE_RANK[me.role] >= ROLE_RANK.exec
  // 한 줄이 도는 동안 모든 줄을 잠근다. 15명이 쓰는 휴지통이라 여러 줄을 동시에 누를 일이
  // 없고, 줄마다 따로 잠그면 어느 요청이 어느 줄 것인지 세는 장치가 하나 더 필요하다.
  const busy = untrash.isPending || purge.isPending
  // 영구 삭제 확인. 되돌릴 수 없어서 `DocWorkspace` 의 휴지통 이동 확인과 같은 Modal 을 쓴다.
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; title: string } | null>(null)

  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  return (
    <>
      <PageHeader
        title="휴지통"
        description={`지운 문서는 ${TRASH_KEEP_DAYS}일 동안 여기 있다가 서버가 영구 삭제합니다.`}
        actions={
          <Link to="/docs" className="text-subtle hover:text-fg text-sm">
            문서로
          </Link>
        }
      />

      {isPending && <SkeletonRows rows={4} />}
      {isError && !data && (
        <Card>
          <CardEmpty onRetry={refetch}>휴지통을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <Table label="휴지통 목록">
          <THead>
            <TR>
              <TH>제목</TH>
              {/* 서버는 "지운 사람"을 따로 안 준다. 여기 실린 건 `updated_by`, 즉 마지막으로
                  손댄 사람이다. 지운 사람과 같다고 보일 이름을 붙이지 않는다. */}
              <TH className="w-28">마지막 수정</TH>
              <TH className="w-24">지운 때</TH>
              <TH className="w-28">영구 삭제까지</TH>
              {/* 이 열에는 되돌리기와 영구 삭제가 같이 있다. 한쪽 이름을 붙이면 스크린리더가
                  다른 버튼을 읽을 때도 그 이름을 같이 읽는다. */}
              <TH className="w-40 text-right">작업</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.length === 0 && (
              <TableEmpty colSpan={COLUMNS}>휴지통이 비었습니다.</TableEmpty>
            )}
            {data.items.map((doc) => {
              const title = doc.title || UNTITLED_DOC
              const left = doc.deleted_at ? daysUntil(purgeAt(doc.deleted_at).toISOString()) : null
              return (
                <TR key={doc.id}>
                  {/* 인라인 요소에는 `truncate` 가 안 걸린다. 칸을 0으로 눕히고 링크를 블록으로
                      만들어야 긴 제목이 표를 가로로 굴리지 않는다. */}
                  <TD className="max-w-0">
                    {/* 휴지통 문서도 열어서 읽을 수는 있다. 서버가 읽기만 열어 둔다. */}
                    <Link
                      to={`/docs/${doc.id}`}
                      className="hover:text-accent block truncate font-medium"
                    >
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
                  <TD className={left !== null && left <= 3 ? 'text-danger' : 'text-muted'}>
                    {left === null ? '-' : left === 0 ? '오늘' : `${left}일`}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`${title} 되돌리기`}
                      disabled={busy}
                      onClick={() =>
                        untrash.mutate(doc.id, {
                          onSuccess: () => toast.success(`${title} 문서를 되돌렸습니다.`),
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
                        onClick={() => setConfirmPurge({ id: doc.id, title })}
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

      <Modal
        open={confirmPurge !== null}
        onClose={() => {
          if (!purge.isPending) setConfirmPurge(null)
        }}
        title="영구 삭제할까요?"
        description="되돌릴 수 없습니다. 버전·댓글까지 같이 사라집니다."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmPurge(null)}
              disabled={purge.isPending}
            >
              취소
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={purge.isPending}
              onClick={() => {
                if (!confirmPurge) return
                purge.mutate(confirmPurge.id, {
                  onSuccess: () => {
                    setConfirmPurge(null)
                    toast.success('영구 삭제했습니다.')
                  },
                  onError: (err) => {
                    setConfirmPurge(null)
                    fail('영구 삭제하지 못했습니다.')(err)
                  },
                })
              }}
            >
              {purge.isPending ? <Spinner className="border-t-white" /> : '영구 삭제'}
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm leading-relaxed">
          <span className="text-fg font-medium">{confirmPurge?.title}</span> 문서가 영구 삭제됩니다.
          되돌릴 수 없습니다.
        </p>
      </Modal>
    </>
  )
}
