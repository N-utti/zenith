import { Bell } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'

export function NotificationsPage() {
  return (
    <>
      <PageHeader title="받은 알림" description="멘션·댓글·채널 알림을 한곳에서 봅니다." />
      <PlaceholderPanel
        icon={Bell}
        milestone="M2 · 커뮤니케이션"
        items={[
          '멘션·댓글·답글 알림 통합 목록',
          '읽음 처리 · 전체 읽음',
          '채널별 알림 설정 (전체 / 멘션만 / 끄기)',
        ]}
      />
    </>
  )
}
