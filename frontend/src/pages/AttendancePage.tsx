import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
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
            : '본인 근태만 조회할 수 있습니다. (설계서 NFR-ATT-02)'
        }
      />
      <PlaceholderPanel
        icon={Clock}
        milestone="일정 미확정 (설계서 §12)"
        items={[
          '출근/퇴근 버튼 — 퇴근은 앱 버튼이 유일한 원천 (설계서 L1)',
          '월별 근태 캘린더 — 미기록은 0이 아니라 "미확정"으로 표기 (설계서 L4)',
          '보정 · 휴가 · 재택 신청, 2단계 경량 승인',
          canSeeOthers ? '팀원 근태 조회 · 승인/반려 · 주 52h 경보' : '본인 연차 잔여 조회',
        ]}
      />
    </>
  )
}
