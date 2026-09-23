import { useSearchParams } from 'react-router'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { AccountList } from '@/features/admin/AccountList'
import { AuditLog } from '@/features/admin/AuditLog'
import { TeamList } from '@/features/admin/TeamList'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_RANK } from '@/types'

const TABS = [
  { key: 'accounts', label: '계정 관리' },
  { key: 'teams', label: '팀' },
  { key: 'audit', label: '감사 기록' },
]

export function AdminPage() {
  const me = useCurrentUser()
  const isExec = ROLE_RANK[me.role] >= ROLE_RANK.exec
  // 탭은 주소에 둔다. 새로고침해도 뒤로 가기를 해도 그 자리다(근태와 같은 규약).
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'accounts'

  // 등급이 모자라면 목록도 기록도 부르지 않는다. 서버가 403 을 주는 경로라 빈 화면이 아니라 에러가 온다.
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
      <PageHeader title="관리자" description="계정·팀·기록은 임원만 볼 수 있습니다." />
      <Tabs
        items={TABS}
        value={tab}
        // 다른 파라미터는 남기고 `tab` 만 바꾼다. 화살표로 탭을 옮길 때마다 히스토리가 쌓이지 않게 replace.
        onChange={(key) =>
          setParams(
            (prev) => {
              prev.set('tab', key)
              return prev
            },
            { replace: true },
          )
        }
      >
        {(key) =>
          key === 'audit' ? <AuditLog /> : key === 'teams' ? <TeamList /> : <AccountList />
        }
      </Tabs>
    </>
  )
}
