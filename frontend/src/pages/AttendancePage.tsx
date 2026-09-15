import { useSearchParams } from 'react-router'
import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
import { Tabs } from '@/components/ui/Tabs'
import { ExceptionSection } from '@/features/attendance/ExceptionSection'
import { LeaveAdminSection } from '@/features/attendance/LeaveAdminSection'
import { LeaveSection } from '@/features/attendance/LeaveSection'
import { MyAttendanceSection } from '@/features/attendance/MyAttendanceSection'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_RANK } from '@/types'

/** 화면마다 탭 하나. 05 SCR-ATT-01(내 근태)·02(휴가)·03(예외 근무). 팀 현황은 뒤에 붙는다. */
const TABS = [
  { key: 'me', label: '내 근태' },
  { key: 'leave', label: '휴가' },
  { key: 'exception', label: '예외 근무' },
]
/** 연차 관리(전사 잔여·사용촉진 대상)는 임원만(10 §3). 숨김은 편의이고 차단은 서버 403. */
const EXEC_TABS = [...TABS, { key: 'leave-admin', label: '연차 관리' }]

export function AttendancePage() {
  const user = useCurrentUser()
  const canSeeOthers = ROLE_RANK[user.role] >= ROLE_RANK.lead
  const isExec = ROLE_RANK[user.role] >= ROLE_RANK.exec
  // 탭은 URL 에 둔다(`?tab=leave`). 알림에서 휴가 탭으로 바로 들어오고, 새로고침해도 그 자리다.
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'me'

  return (
    <>
      <PageHeader
        title="근태"
        description={
          canSeeOthers
            ? '본인 근태와 팀 근태를 확인합니다.'
            : '본인 근태만 조회할 수 있습니다. (설계서 NFR-ATT-01)'
        }
      />
      <Tabs
        items={isExec ? EXEC_TABS : TABS}
        value={tab}
        // 다른 파라미터는 남기고 `tab` 만 바꾼다. 화살표로 탭을 옮길 때마다 히스토리가 쌓이지 않게 replace.
        onChange={(key) =>
          setParams(
            (prev) => {
              if (key === 'me') prev.delete('tab')
              else prev.set('tab', key)
              return prev
            },
            { replace: true },
          )
        }
      >
        {(key) =>
          key === 'leave' ? (
            <LeaveSection />
          ) : key === 'leave-admin' ? (
            <LeaveAdminSection />
          ) : key === 'exception' ? (
            <ExceptionSection />
          ) : (
            <div className="space-y-6">
              <MyAttendanceSection />
              <PlaceholderPanel
                icon={Clock}
                milestone="일정 미확정 (설계서 §12)"
                items={[
                  '신청 승인 흐름(전자결재 편입, 설계서 13)',
                  canSeeOthers ? '팀원 근태 조회 · 신청 승인/반려' : '연차 사용촉진 안내',
                ]}
              />
            </div>
          )
        }
      </Tabs>
    </>
  )
}
