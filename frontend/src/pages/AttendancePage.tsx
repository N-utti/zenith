import { Settings } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { BackLink } from '@/components/ui/BackLink'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useAttendanceRoles } from '@/features/attendance/api'
import { AttendanceRolesSection } from '@/features/attendance/AttendanceRolesSection'
import { CompanyAttendanceSection } from '@/features/attendance/CompanyAttendanceSection'
import { ExceptionSection } from '@/features/attendance/ExceptionSection'
import { HolidaySection } from '@/features/attendance/HolidaySection'
import { LeaveAdminSection } from '@/features/attendance/LeaveAdminSection'
import { LeaveSection } from '@/features/attendance/LeaveSection'
import { MonthClosingSection } from '@/features/attendance/MonthClosingSection'
import { RangeSummarySection } from '@/features/attendance/RangeSummarySection'
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
 * 근태 현황(직원 × 일자 그리드)와 연차 관리(전사 잔여·사용촉진 대상)는 임원과 근태 담당자만(10 §3). 숨김은 편의이고 차단은 서버 403.
 * 05 의 "팀 근태 현황"은 팀장 대상이지만 이 회사에는 팀장이 없어(조직도) 전사 단위로 두었다(2026-09-15 결정).
 * 근태 담당자(백엔드 README 76)도 임원처럼 이 셋을 한다. 내 근태 탭 뒤에 `관리` 묶음으로 붙인다. 경계가 안 보이면 어디부터 관리인지 모호하다.
 */
const MANAGE_TABS = [
  ...TABS,
  { key: 'company', label: '근태 현황', group: '관리' },
  { key: 'leave-admin', label: '연차 관리', group: '관리' },
  // 근태 마감(05 SCR-ATT-06 상당): 월 마감과 리포트 내보내기. 결근 확정·정합성 검증은 아직 없다.
  { key: 'admin', label: '근태 마감', group: '관리' },
]

export function AttendancePage() {
  const user = useCurrentUser()
  const isExec = ROLE_RANK[user.role] >= ROLE_RANK.exec
  const roles = useAttendanceRoles()
  const isManager = roles.data?.manager?.id === user.id
  // 탭은 URL 에 둔다(`?tab=leave`). 알림에서 휴가 탭으로 바로 들어오고, 새로고침해도 그 자리다.
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'me'

  // 근태 설정(05 SCR-ATT-07 상당): 회사 휴일과 근태 담당자·대표 지정, 임원만. 1년에 몇 번 안 만져서 탭이 아니라
  // 제목 줄의 톱니바퀴로 연다. 주소는 예전 탭 그대로(`?tab=settings`). 법정 공휴일(2026-09-16)·휴가 종류·연차 부여
  // 기준(2026-09-15)은 사용자가 뺐다. 근태 담당자는 이 화면을 못 본다(서버도 403).
  if (isExec && tab === 'settings') {
    return (
      <>
        <BackLink to="/attendance">근태</BackLink>
        <PageHeader title="근태 설정" />
        <div className="space-y-6">
          <AttendanceRolesSection />
          <HolidaySection />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="근태"
        actions={
          isExec && (
            <Link
              to="/attendance?tab=settings"
              aria-label="근태 설정"
              title="근태 설정"
              className="text-muted hover:bg-surface-hover hover:text-fg inline-flex size-8 items-center justify-center rounded-lg transition-colors"
            >
              <Settings className="size-4" />
            </Link>
          )
        }
      />
      <Tabs
        items={isExec || isManager ? MANAGE_TABS : TABS}
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
          ) : key === 'exception' ? (
            <ExceptionSection />
          ) : (
            <div className="space-y-6">
              <MyAttendanceSection />
              <RangeSummarySection />
            </div>
          )
        }
      </Tabs>
    </>
  )
}
