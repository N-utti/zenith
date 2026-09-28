import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useExportCrm, type ExportEntity } from './api'

const LABEL: Record<ExportEntity, string> = { orgs: '기관', contacts: '담당자', deals: '안건' }

/**
 * 목록 전체를 xlsx 로 내려받는다(15 FR-CRM-32). 걸어 둔 필터와 상관없이 전부 나간다.
 * 휴대폰 폭에서는 숨긴다. 머리의 등록 버튼이 밀려 잘리고, 폰에서 엑셀을 뽑을 일은 드물다(15 §10 모바일).
 */
export function ExportButton({ entity }: { entity: ExportEntity }) {
  const toast = useToast()
  const exporting = useExportCrm()
  return (
    <Button
      variant="secondary"
      size="sm"
      className="hidden sm:inline-flex"
      disabled={exporting.isPending}
      title={`${LABEL[entity]} 목록 전체를 엑셀로 내려받습니다. 누가 내려받았는지 기록됩니다.`}
      onClick={() =>
        exporting.mutate(entity, {
          onError: (err) =>
            toast.error(err instanceof ApiError ? err.message : '내려받지 못했습니다.'),
        })
      }
    >
      {exporting.isPending ? <Spinner /> : <Download className="size-4" />}
      {LABEL[entity]} 내보내기
    </Button>
  )
}
