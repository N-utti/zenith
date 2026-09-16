import { useSearchParams } from 'react-router'
import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
import { Tabs } from '@/components/ui/Tabs'
import { CompanyAttendanceSection } from '@/features/attendance/CompanyAttendanceSection'
import { ExceptionSection } from '@/features/attendance/ExceptionSection'
import { HolidaySection } from '@/features/attendance/HolidaySection'
import { LeaveAdminSection } from '@/features/attendance/LeaveAdminSection'
import { LeaveSection } from '@/features/attendance/LeaveSection'
import { MonthClosingSection } from '@/features/attendance/MonthClosingSection'
import { MyAttendanceSection } from '@/features/attendance/MyAttendanceSection'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_RANK } from '@/types'

/** 화면마다 탭 하나. 05 SCR-ATT-01(내 근태)·02(휴가)·03(예외 근무). 팀 현황은 뒤에 붙는다. */
const TABS = [
  { key: 'me', label: '내 근태' },
  { key: 'leave', label: '휴가' },
  { key: 'exception', label: '예외 근무' },
]
/**
 * 전사 근태(직원 × 일자 그리드)와 연차 관리(전사 잔여·사용촉진 대상)는 임원만(10 §3). 숨김은 편의이고 차단은 서버 403.
 * 05 의 "팀 근태 현황"은 팀장 대상이지만 이 회사에는 팀장이 없어(조직도) 전사 단위로 두었다(2026-09-15 결정).
 */
const EXEC_TABS = [
  ...TABS,
  { key: 'company', label: '전사 근태' },
  { key: 'leave-admin', label: '연차 관리' },
  // 근태 관리(05 SCR-ATT-06 상당): 지금은 월 마감만. 리포트 내보내기·결근 확정은 뒤에 붙는다.
  { key: 'admin', label: '근태 관리' },
  // 근태 설정(05 SCR-ATT-07 상당): 공휴일·회사 휴일만. 휴가 종류·연차 부여 기준은 사용자가 뺐다(2026-09-15).
  { key: 'settings', label: '근태 설정' },
]

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
          ) : key === 'company' ? (
            <CompanyAttendanceSection />
          ) : key === 'leave-admin' ? (
            <LeaveAdminSection />
          ) : key === 'admin' ? (
            <MonthClosingSection />
          ) : key === 'settings' ? (
            <HolidaySection />
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
                  canSeeOthers ? '신청 승인/반려' : '연차 사용촉진 안내',
                ]}
              />
            </div>
          )
        }
      </Tabs>
    </>
  )
}
