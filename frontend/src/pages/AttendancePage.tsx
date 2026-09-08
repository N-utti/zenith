import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
import { LeaveSection } from '@/features/attendance/LeaveSection'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_RANK } from '@/types'

export function AttendancePage() {
  const user = useCurrentUser()
  const canSeeOthers = ROLE_RANK[user.role] >= ROLE_RANK.lead

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
      <div className="space-y-6">
        <LeaveSection />
        <PlaceholderPanel
          icon={Clock}
          milestone="일정 미확정 (설계서 §12)"
          items={[
            // 설계서 v0.3: 출퇴근 시각을 기록하지 않는다. 기록하는 것은 예외뿐이다.
            '월별 근태 캘린더: 휴가 · 재택 · 외근 · 출장 상태 표시 (설계서 SCR-ATT-01)',
            '재택 · 외근 · 출장 · 연장근로 신청, 팀장 1단계 승인',
            canSeeOthers ? '팀원 근태 조회 · 신청 승인/반려' : '연차 사용촉진 안내',
          ]}
        />
      </div>
    </>
  )
}
