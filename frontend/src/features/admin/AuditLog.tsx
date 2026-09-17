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

/**
 * 서버가 스스로 남기는 기록. 여기만 한 사람이 없는 게 정상이다.
 *
 * 행위자가 비는 경우는 둘인데 뜻이 정반대다. 휴지통 자동 정리는 서버가 한 일이고,
 * 로그인 실패는 **누군지 모르는 사람**이 한 일이다. 없는 이메일로 두드리는 외부인이
 * "시스템" 으로 보이면, 이 화면을 보는 이유(보안 사고 판단)가 거꾸로 선다.
 */
const SYSTEM_KINDS = new Set(['docs.purged'])

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
  const { data: users } = useUsers()
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAudit(kind)

  const nameOf = (event: { actor_id: string | null; kind: string }) => {
    if (event.actor_id) {
      return users?.find((user) => user.id === event.actor_id)?.name ?? '알 수 없음'
    }
    return SYSTEM_KINDS.has(event.kind) ? '시스템' : '알 수 없음'
  }

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
      {/* 이미 받아 둔 장이 있으면 표를 지우지 않는다. "더 보기" 실패는 버튼 옆에서 말한다. */}
      {isError && !data && (
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
                    <TD className="truncate">{nameOf(event)}</TD>
                    {/* 아이피가 없는 기록도 있다(서버가 스스로 남긴 것). 빈칸 대신 자리를 표시한다. */}
                    <TD className="text-muted truncate">{event.ip ?? '-'}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>

          {hasNextPage && (
            <div className="mt-3 grid place-items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Spinner /> : '더 보기'}
              </Button>
              {isError && (
                <p role="alert" className="text-danger text-xs">
                  다음 기록을 불러오지 못했습니다.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
