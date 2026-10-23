import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { MailLink } from '@/components/ui/MailLink'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTeams, useUsers } from './api'
import { UserModal } from './UserModal'
import type { AdminUser } from './types'
import { hueOf } from '@/lib/avatar'
import { formatISOYearDate } from '@/lib/datetime'
import { ROLE_LABEL } from '@/types'

/** 열 수: 표가 비었을 때 가운데 문구가 걸칠 칸 수. */
const COLUMNS = 6

export function AccountList() {
  const me = useCurrentUser()
  const { data, isPending, isError, refetch } = useUsers()
  // 계정 줄은 팀 id 만 들고 온다(`UserOut`). 이름은 팀 목록에서 맞춘다.
  const teams = useTeams()
  /**
   * 소속 없음과 **아직 모름** 을 가른다.
   *
   * 팀 목록은 계정 목록과 따로 뜨는 요청이라 늦게 오고, 실패하면 4xx 는 다시 부르지 않는다.
   * 둘을 다 `-` 로 적으면 팀이 있는 사람까지 소속 없음으로 보이고, 실패했을 때는 그 거짓이
   * 영영 남는다.
   */
  const teamCell = (id: string | null) => {
    if (!id) return '-'
    return teams.data?.find((team) => team.id === id)?.name ?? (teams.isError ? '확인 불가' : '…')
  }
  /** 열려 있는 대화상자. `new` 는 새 계정, 그 밖에는 고치는 계정. */
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" className="ml-auto" onClick={() => setEditing('new')}>
          <UserPlus className="size-4" />새 계정
        </Button>
      </div>

      {isPending && <SkeletonRows />}
      {isError && !data && (
        <Card>
          <CardEmpty onRetry={refetch}>계정 목록을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <Table label="계정 목록" wide>
          <THead>
            <TR>
              <TH>이름</TH>
              <TH>이메일</TH>
              <TH className="w-24">등급</TH>
              <TH className="w-36">소속</TH>
              <TH className="w-28">입사일</TH>
              <TH className="w-24 text-right">관리</TH>
            </TR>
          </THead>
          <TBody>
            {data.length === 0 && <TableEmpty colSpan={COLUMNS}>계정이 없습니다.</TableEmpty>}
            {data.map((user) => (
              <TR key={user.id} muted={!user.active}>
                <TD>
                  <span className="flex items-center gap-2">
                    <Avatar name={user.name} hue={hueOf(user.id)} size="sm" />
                    <span className="truncate font-medium">{user.name}</span>
                    {user.id === me.id && <Badge tone="accent">나</Badge>}
                    {!user.active && <Badge tone="danger">비활성</Badge>}
                  </span>
                </TD>
                <TD>
                  <MailLink email={user.email} />
                </TD>
                <TD>
                  <Badge>{ROLE_LABEL[user.role]}</Badge>
                </TD>
                <TD className="text-muted">{teamCell(user.team_id)}</TD>
                <TD className="text-muted">
                  {user.hire_date ? formatISOYearDate(user.hire_date) : '-'}
                </TD>
                <TD className="text-right">
                  {/* 줄마다 "편집" 이라 화면을 안 보는 사람에게는 열세 개가 다 같은 이름이다. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${user.name} 계정 편집`}
                    onClick={() => setEditing(user)}
                  >
                    편집
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && (
        <UserModal
          user={editing === 'new' ? undefined : editing}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
