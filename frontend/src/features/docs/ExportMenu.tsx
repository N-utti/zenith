import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Download, FileText, FileType, Printer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { MenuItem, ToolMenu } from './editorControls'
import { exportDoc, type ExportFormat } from './exportDoc'

const FORMATS: { key: ExportFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { key: 'docx', label: 'Word 문서', hint: '.docx', icon: FileText },
  { key: 'hwpx', label: '한글 문서', hint: '.hwpx', icon: FileType },
  { key: 'pdf', label: 'PDF', hint: '인쇄 창에서 저장', icon: Printer },
]

/** 문서를 다른 형식의 파일로 내려받는다. 지금 화면의 본문이 그대로 나간다. */
export function ExportMenu({ editor, title }: { editor: Editor; title: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async (format: ExportFormat) => {
    if (busy) return
    setBusy(true)
    try {
      const { missingImages } = await exportDoc(format, title, editor)
      if (missingImages > 0) {
        toast.info(`사진 ${missingImages}장은 불러오지 못해 파일에서 빠졌습니다.`)
      }
    } catch {
      // 사진을 못 받는 것은 위에서 수로 알린다. 여기 오는 것은 변환이 실패한 경우뿐이다.
      toast.error('내보내지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolMenu
      label="내보내기"
      align="end"
      className="w-56"
      trigger={busy ? <Spinner /> : <Download className="size-4" />}
    >
      {(close) =>
        FORMATS.map(({ key, label, hint, icon }) => (
          <MenuItem
            key={key}
            icon={icon}
            label={label}
            hint={hint}
            onClick={() => {
              close()
              void run(key)
            }}
          />
        ))
      }
    </ToolMenu>
  )
}
