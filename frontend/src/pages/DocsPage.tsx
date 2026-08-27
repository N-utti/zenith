import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlaceholderPanel } from '@/components/ui/PlaceholderPanel'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'

export function DocsPage() {
  return (
    <>
      <PageHeader
        title="문서"
        description="사내 위키와 회의록. 실시간 공동편집을 지원합니다."
        actions={
          <Button size="sm" disabled>
            <Plus className="size-4" />새 문서
          </Button>
        }
      />
      <PlaceholderPanel
        icon={FileText}
        milestone="M1 · 코어"
        items={[
          '문서 트리 · 목록 · 검색',
          'TipTap 에디터 + Yjs 실시간 공동편집 (2인 동시편집 1초 이내 반영)',
          '댓글 · 멘션 · 버전 히스토리',
          '문서 인라인 AI (M3)',
        ]}
      />
    </>
  )
}
