import { Megaphone } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'

export function BoardPage() {
  return (
    <>
      <PageHeader title="게시판" description="전사 공지와 등급별 게시판." />
      <PlaceholderPanel
        icon={Megaphone}
        milestone="M4 · 마감"
        items={[
          '전사 · 팀장 · 임원 3등급 게시판',
          '등급 밖 글은 목록에서 제목 마스킹, 본문 API 403',
          '공지 상단 고정 · 읽음 확인',
        ]}
      />
    </>
  )
}
