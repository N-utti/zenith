import { PageHeader } from '@/components/ui/PageHeader'
import { AttendanceWidget } from '@/features/attendance/AttendanceWidget'
import { AnnouncementsCard } from '@/features/home/AnnouncementsCard'
import { RecentDocsCard } from '@/features/home/RecentDocsCard'
import { TeamAlertsCard } from '@/features/home/TeamAlertsCard'
import { UnreadChatCard } from '@/features/home/UnreadChatCard'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_LABEL, ROLE_RANK } from '@/types'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '늦은 시간까지 고생 많으십니다'
  if (hour < 12) return '좋은 아침입니다'
  if (hour < 18) return '안녕하세요'
  return '오늘도 수고하셨습니다'
}

export function HomePage() {
  const user = useCurrentUser()
  const canSeeTeam = ROLE_RANK[user.role] >= ROLE_RANK.lead

  return (
    <>
      <PageHeader
        title={`${user.name}님, ${greeting()}`}
        description={`${user.team.name} · ${ROLE_LABEL[user.role]}`}
      />

      <div className="space-y-4">
        <AttendanceWidget />

        <div className="grid gap-4 lg:grid-cols-2">
          <AnnouncementsCard />
          <UnreadChatCard />
          <RecentDocsCard />
          {canSeeTeam && <TeamAlertsCard />}
        </div>
      </div>
    </>
  )
}
