import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { History, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatDay, formatTime } from '@/lib/datetime'
import type { RestoredContent } from './versioning'
import type { DocVersion } from './types'

/**
 * 과거 버전을 읽기 전용으로 보여 준다.
 *
 * 협업 확장 없이 순수 내용만 렌더한다. 미리보기가 Y.Doc에 붙으면 보는 것만으로
 * 문서가 바뀌어 다른 사람에게 전파된다.
 */
export function VersionPreview({
  version,
  content,
  onRestore,
  onClose,
  restoring,
}: {
  version: DocVersion
  content: RestoredContent
  onRestore: () => void
  onClose: () => void
  restoring: boolean
}) {
  const editor = useEditor(
    {
      editable: false,
      extensions: [StarterKit.configure({ undoRedo: false })],
      content: content.json,
      editorProps: { attributes: { class: 'zenith-editor outline-none' } },
    },
    [content],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-warning/30 bg-warning/10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <History className="text-warning size-4 shrink-0" />
        <p className="text-fg flex-1 text-sm">
          {formatDay(version.createdAt)} {formatTime(version.createdAt)} 버전을 보고 있습니다.
          <span className="text-muted"> {version.authorName} 편집 · 읽기 전용</span>
        </p>
        <Button size="sm" onClick={onRestore} disabled={restoring}>
          <RotateCcw className="size-4" />
          이 버전으로 되돌리기
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="미리보기 닫기">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <h1 className="text-fg py-2 text-3xl font-bold tracking-tight">
            {content.title ?? '제목 없는 문서'}
          </h1>
          <div className="mt-4">{editor && <EditorContent editor={editor} />}</div>
        </div>
      </div>
    </div>
  )
}
