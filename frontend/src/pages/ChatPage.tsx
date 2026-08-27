import { MessagesSquare } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'

export function ChatPage() {
  return (
    <>
      <PageHeader title="채팅" description="채널과 DM." />
      <PlaceholderPanel
        icon={MessagesSquare}
        milestone="M2 · 커뮤니케이션"
        items={[
          '채널 목록 · DM · 안 읽음 카운트',
          'WebSocket 실시간 수신 · 타이핑 인디케이터',
          '파일 첨부 (MinIO) · 스레드 · 이모지 반응',
          '알림 (데스크톱/모바일 푸시)',
        ]}
      />
    </>
  )
}
