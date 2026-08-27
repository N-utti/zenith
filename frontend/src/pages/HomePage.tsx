import { House } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ROLE_LABEL } from '@/types'

export function HomePage() {
  const user = useCurrentUser()

  return (
    <>
      <PageHeader
        title={`${user.name}님, 안녕하세요`}
        description={`${user.team.name} · ${ROLE_LABEL[user.role]}`}
      />
      <PlaceholderPanel
        icon={House}
        milestone="M2 · 커뮤니케이션"
        items={[
          '오늘의 공지 · 안 읽은 채팅 · 최근 문서 카드',
          '내 근태 위젯 (출근/퇴근 버튼, 이번 주 누적 근로시간)',
          '팀 주 52시간 경보 (lead 이상)',
        ]}
      />
    </>
  )
}
