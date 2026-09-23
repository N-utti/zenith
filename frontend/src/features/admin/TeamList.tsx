import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/Table'
import { useToast } from '@/components/ui/ToastContext'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { ApiError } from '@/lib/api'
import type { Team } from '@/types'
import { useSaveTeam, useTeams, useUsers } from './api'

/** 서버 `TeamIn.name` 상한. */
const TEAM_NAME_MAX = 100

const COLUMNS = 3

/**
 * 팀 목록과 만들기·이름 바꾸기. 지우는 길은 서버에 없다(04 §9).
 *
 * 인원은 계정 목록에서 센다. 팀 목록은 id·이름만 준다.
 */
export function TeamList() {
  const { data, isPending, isError, refetch } = useTeams()
  const users = useUsers()
  const save = useSaveTeam()
  const toast = useToast()
  /** 열려 있는 대화상자. `new` 는 새 팀, 그 밖에는 이름을 바꿀 팀. */
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 비활성 계정도 소속은 남아 있다. 이름을 바꾸면 그 사람들도 따라가니 같이 센다.
  const headcount = (id: string) =>
    users.data
      ? String(users.data.filter((user) => user.team_id === id).length)
      : users.isError
        ? '-'
        : '…'

  const open = (target: Team | 'new') => {
    setError(null)
    setEditing(target)
  }

  const submit = (name: string) => {
    if (!editing) return
    const team = editing === 'new' ? undefined : editing
    save.mutate(
      { id: team?.id, name },
      {
        onSuccess: () => {
          setEditing(null)
          toast.success(team ? '팀 이름을 바꿨습니다.' : '새 팀을 만들었습니다.')
        },
        // 같은 이름이면 409 「같은 이름의 팀이 있습니다.」가 그대로 온다.
        onError: (err) => setError(err instanceof ApiError ? err.message : '저장하지 못했습니다.'),
      },
    )
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-subtle text-xs">
          이름을 바꿔도 소속된 사람은 그대로입니다. 팀을 지우는 기능은 없습니다.
        </p>
        <Button size="sm" className="ml-auto" onClick={() => open('new')}>
          <Plus className="size-4" />새 팀
        </Button>
      </div>

      {isPending && <SkeletonRows />}
      {isError && !data && (
        <Card>
          <CardEmpty onRetry={refetch}>팀 목록을 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}

      {data && (
        <Table label="팀 목록">
          <THead>
            <TR>
              <TH>팀 이름</TH>
              <TH className="w-24">인원</TH>
              <TH className="w-28 text-right">관리</TH>
            </TR>
          </THead>
          <TBody>
            {data.length === 0 && <TableEmpty colSpan={COLUMNS}>팀이 없습니다.</TableEmpty>}
            {data.map((team) => (
              <TR key={team.id}>
                <TD className="font-medium">{team.name}</TD>
                <TD className="text-muted">{headcount(team.id)}</TD>
                <TD className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${team.name} 이름 바꾸기`}
                    onClick={() => open(team)}
                  >
                    이름 바꾸기
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && (
        <FolderNameModal
          title={editing === 'new' ? '새 팀' : '팀 이름 바꾸기'}
          label="팀 이름"
          placeholder="예: 기획팀"
          maxLength={TEAM_NAME_MAX}
          initial={editing === 'new' ? '' : editing.name}
          submitLabel={editing === 'new' ? '만들기' : '바꾸기'}
          pending={save.isPending}
          error={error}
          onDirty={() => setError(null)}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
