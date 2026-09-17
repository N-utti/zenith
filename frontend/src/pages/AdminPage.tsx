import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useUsers } from '@/features/admin/api'
import { UserModal } from '@/features/admin/UserModal'
import type { AdminUser } from '@/features/admin/types'
import { hueOf } from '@/lib/avatar'
import { formatISOYearDate } from '@/lib/datetime'
import { ROLE_LABEL, ROLE_RANK } from '@/types'

/** 열 수: 표가 비었을 때 가운데 문구가 걸칠 칸 수. */
const COLUMNS = 5

export function AdminPage() {
  const me = useCurrentUser()
  const isExec = ROLE_RANK[me.role] >= ROLE_RANK.exec
  // 등급이 모자라면 부르지 않는다. 서버가 403 을 주는 경로라 빈 목록이 아니라 에러가 온다.
  const { data, isPending, isError } = useUsers(isExec)
  /** 열려 있는 대화상자. `new` 는 새 계정, 그 밖에는 고치는 계정. */
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)

  if (!isExec) {
    return (
      <>
        <PageHeader title="관리자" />
        <Card>
          <CardEmpty>임원만 볼 수 있는 화면입니다.</CardEmpty>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="계정 관리"
        description="사내 계정을 만들고 등급·활성 상태를 바꿉니다."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <UserPlus className="size-4" />새 계정
          </Button>
        }
      />

      {isPending && <SkeletonRows />}
      {isError && (
        <Card>
          <CardEmpty>계정 목록을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <Table>
          <THead>
            <TR>
              <TH>이름</TH>
              <TH>이메일</TH>
              <TH className="w-24">등급</TH>
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
                <TD className="text-muted">{user.email}</TD>
                <TD>
                  <Badge>{ROLE_LABEL[user.role]}</Badge>
                </TD>
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
