import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'

export function AiPage() {
  return (
    <>
      <PageHeader
        title="AI 어시스턴트"
        description="사내 위키를 근거로 답합니다. 추론은 사내망을 벗어나지 않습니다."
      />
      <PlaceholderPanel
        icon={Sparkles}
        milestone="M3 · AI"
        items={[
          '대화형 어시스턴트 (Ollama 8B · 스트리밍 응답)',
          '위키 RAG — 사실문장마다 출처 각주',
          '권한 필터 — 열람 권한 밖 문서는 근거에서 자동 제외',
          '프롬프트 템플릿 (회의록 요약, 공지 초안)',
        ]}
      />
    </>
  )
}
