import { PageHeader } from '@/components/ui/PageHeader'
import { AnnouncementsCard } from '@/features/home/AnnouncementsCard'
import { RecentDocsCard } from '@/features/home/RecentDocsCard'
import { UnreadChatCard } from '@/features/home/UnreadChatCard'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_LABEL } from '@/types'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '늦은 시간까지 고생 많으십니다'
  if (hour < 12) return '좋은 아침입니다'
  if (hour < 18) return '안녕하세요'
  return '오늘도 수고하셨습니다'
}

export function HomePage() {
  const user = useCurrentUser()

  return (
    <>
      <PageHeader
        title={`${user.name}님, ${greeting()}`}
        description={`${user.team.name} · ${ROLE_LABEL[user.role]}`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <AnnouncementsCard />
        <UnreadChatCard />
        <RecentDocsCard />
      </div>
    </>
  )
}
