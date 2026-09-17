import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { useAudit, useUsers } from './api'
import { auditView, AUDIT_FILTERS, type AuditTone } from './audit'

const COLUMNS = 4

const TONE: Record<AuditTone, string> = {
  neutral: 'text-fg',
  warning: 'text-warning',
  danger: 'text-danger',
}

/**
 * 감사 기록. 누가 무엇을 했는지만 남는 읽기 전용 화면이다(고치거나 지우는 길은 서버에 없다).
 *
 * 한 행위자는 id 로만 온다. 이름은 계정 목록에서 찾는다. 같은 화면(관리자)이 이미 부르는
 * 목록이라 요청이 늘지 않고, 계정이 지워지는 일이 없으므로 대개 찾힌다.
 */
export function AuditLog() {
  const [kind, setKind] = useState('')
  const { data: users } = useUsers(true)
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useAudit(
    kind,
    true,
  )

  const nameOf = (id: string | null) =>
    id ? (users?.find((user) => user.id === id)?.name ?? '알 수 없음') : '시스템'

  const rows = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="w-44">
          <Select
            aria-label="기록 종류"
            options={AUDIT_FILTERS}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
        </div>
        <p className="text-subtle text-xs">최신순입니다. 기록은 고치거나 지울 수 없습니다.</p>
      </div>

      {isPending && <SkeletonRows />}
      {isError && (
        <Card>
          <CardEmpty>감사 기록을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <>
          <Table>
            <THead>
              <TR>
                <TH className="w-44">시각</TH>
                <TH>무슨 일</TH>
                <TH className="w-32">한 사람</TH>
                <TH className="w-36">어디서</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 && (
                <TableEmpty colSpan={COLUMNS}>남은 기록이 없습니다.</TableEmpty>
              )}
              {rows.map((event) => {
                const view = auditView(event)
                return (
                  <TR key={event.id}>
                    <TD className="text-muted whitespace-nowrap">{formatDateTime(event.at)}</TD>
                    <TD>
                      <p className={cn('font-medium', TONE[view.tone])}>{view.summary}</p>
                      {view.detail && <p className="text-muted mt-0.5 text-xs">{view.detail}</p>}
                    </TD>
                    <TD className="truncate">{nameOf(event.actor_id)}</TD>
                    {/* 아이피가 없는 기록도 있다(서버가 스스로 남긴 것). 빈칸 대신 자리를 표시한다. */}
                    <TD className="text-muted truncate">{event.ip ?? '-'}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>

          {hasNextPage && (
            <div className="mt-3 grid place-items-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Spinner /> : '더 보기'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
