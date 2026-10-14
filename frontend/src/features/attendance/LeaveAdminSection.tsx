import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { ApiError } from '@/lib/api'
import { ROLE_LABEL } from '@/types'
import { useAllLeaveBalances } from './api'
import { leavePromotion, SECOND_NOTICE_WARN_DAYS, type LeavePromotion } from './leaveBalance'
import { Stat } from './Stat'
import type { LeaveBalanceRow } from './types'

const GRANT_BASIS_LABEL: Record<LeaveBalanceRow['grant_basis'], string> = {
  hire_date: '입사일',
  fiscal_year: '회계연도',
}

const STAGE_LABEL: Record<LeavePromotion['stage'], string> = {
  first: '1차 촉구',
  second: '2차 통보',
  expiring: '소멸 예정',
}

/**
 * 연차 관리(임원): 전 직원의 부여·사용·잔여·소멸일 한 표(FR-ATT-22·23).
 * 사용촉진 기한(1차 촉구·2차 통보)이 가깝거나 지난 사람을 위에 모으고 그 기한을 같이 보인다.
 * 시점만 알린다. 통지 발송과 그 기록, 부여 조정·정책 설정은 없다.
 */
export function LeaveAdminSection() {
  const balances = useAllLeaveBalances()
  const rows = (balances.data?.items ?? []).map((row) => ({
    ...row,
    promotion: leavePromotion(row),
  }))
  // 사용촉진 대상이 먼저, 그다음은 잔여가 많은 순. 챙겨야 할 사람이 위에 오게.
  rows.sort(
    (a, b) =>
      Number(b.promotion?.urgent ?? false) - Number(a.promotion?.urgent ?? false) ||
      b.remaining - a.remaining,
  )
  const total = rows.reduce(
    (acc, r) => ({
      granted: acc.granted + r.granted,
      used: acc.used + r.used,
      remaining: acc.remaining + r.remaining,
    }),
    { granted: 0, used: 0, remaining: 0 },
  )
  const urgent = rows.filter((row) => row.promotion?.urgent).length

  return (
    <div className="space-y-4">
      {/* 쿼리가 하나라 로딩·오류는 아래 표에서만 알린다. 카드는 데이터가 있을 때만. */}
      {balances.data && (
        <Card>
          <CardHeader title="전사 연차" />
          <dl className="flex flex-wrap gap-6 px-5 pb-4">
            <Stat label="부여" value={total.granted} />
            <Stat label="사용" value={total.used} hint="승인 대기분 포함" />
            <Stat label="잔여" value={total.remaining} strong />
            <Stat
              label="사용촉진 대상"
              value={urgent}
              unit="명"
              hint={`촉진 기한 ${SECOND_NOTICE_WARN_DAYS}일 안이거나 지남`}
            />
          </dl>
        </Card>
      )}

      <Table label="직원별 연차 목록" wide>
        <THead>
          <tr>
            <TH>이름</TH>
            <TH>소속</TH>
            <TH className="text-right">부여</TH>
            <TH className="text-right">사용</TH>
            <TH className="text-right">잔여</TH>
            <TH>소멸일</TH>
            <TH>촉진 기한</TH>
            <TH>기준</TH>
          </tr>
        </THead>
        <TBody>
          {balances.isPending && <TableEmpty colSpan={8}>불러오는 중</TableEmpty>}
          {balances.isError && (
            <TableEmpty colSpan={8}>
              {/* 403 이면 서버 문구("임원만")가 그대로 온다. */}
              {balances.error instanceof ApiError
                ? balances.error.message
                : '연차 현황을 불러오지 못했습니다.'}
            </TableEmpty>
          )}
          {balances.data && rows.length === 0 && (
            <TableEmpty colSpan={8}>직원이 없습니다.</TableEmpty>
          )}
          {rows.map((row) => (
            <TR key={row.user.id}>
              <TD className="whitespace-nowrap">
                {row.user.name}
                {row.promotion?.urgent && (
                  <Badge tone="warning" className="ml-2">
                    {STAGE_LABEL[row.promotion.stage]}
                  </Badge>
                )}
              </TD>
              {/* 임원은 팀이 없다(조직도). 그 외에 팀이 비면 등급을 소속인 양 쓰지 않고 빈 값으로. */}
              <TD className="text-muted whitespace-nowrap">
                {row.user.team?.name ?? (row.user.role === 'exec' ? ROLE_LABEL.exec : '-')}
              </TD>
              <TD className="text-right tabular-nums">{row.granted}</TD>
              <TD className="text-right tabular-nums">{row.used}</TD>
              <TD className="text-right font-medium tabular-nums">{row.remaining}</TD>
              <TD
                className={
                  row.promotion?.stage === 'expiring'
                    ? 'text-warning whitespace-nowrap'
                    : 'whitespace-nowrap'
                }
              >
                {row.expires_on}
              </TD>
              {/* 2차 기한이 지나면 남은 기한이 없다. 소멸일이 대신 강조된다. */}
              <TD
                className={
                  row.promotion?.urgent && row.promotion.stage !== 'expiring'
                    ? 'text-warning whitespace-nowrap'
                    : 'whitespace-nowrap'
                }
              >
                {row.promotion && row.promotion.stage !== 'expiring' ? row.promotion.due : '-'}
              </TD>
              <TD className="text-muted">{GRANT_BASIS_LABEL[row.grant_basis]}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
