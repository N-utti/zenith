import { useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { docContentExtensions } from './editorExtensions'
import { History, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { formatDay, formatTime } from '@/lib/datetime'
import { tableBleedRef } from './tableBleed'
import { diffBlocks, VersionDiff } from './versionDiff'
import type { RestoredContent } from './versioning'
import type { DocVersion } from './types'

/**
 * 과거 버전을 읽기 전용으로 보여 준다. 바로 앞 버전이 있으면 거기서 바뀐 곳을 git diff 처럼
 * 칠한다: 더한 블록은 초록, 지운 블록은 빨강으로 제자리에 끼워 보인다.
 *
 * 협업 확장 없이 순수 내용만 렌더한다. 미리보기가 Y.Doc에 붙으면 보는 것만으로
 * 문서가 바뀌어 다른 사람에게 전파된다.
 */
export function VersionPreview({
  version,
  content,
  before,
  widthClass,
  onRestore,
  onClose,
  restoring,
}: {
  version: DocVersion
  content: RestoredContent
  /** 바로 앞 버전. 있으면 그것과 견줘 바뀐 곳을 칠한다. 첫 버전이거나 못 읽었으면 `null`. */
  before: RestoredContent | null
  /** 지금 문서의 본문 폭(`useCollabWidth`). 편집 화면과 같은 폭으로 보여야 표가 같은 모양이다. */
  widthClass: string
  onRestore: () => void
  onClose: () => void
  restoring: boolean
}) {
  // 되돌리기는 `content` 를 그대로 쓴다. 여기서 합친 문서(지워진 블록 포함)는 보여 주기만 한다.
  const diff = useMemo(() => before && diffBlocks(before.json, content.json), [before, content])
  const titleChanged = before !== null && before.title !== content.title

  const editor = useEditor(
    {
      editable: false,
      extensions: [
        ...docContentExtensions(),
        ...(diff ? [VersionDiff.configure({ marks: diff.marks })] : []),
      ],
      content: diff?.json ?? content.json,
      editorProps: { attributes: { class: 'zenith-editor outline-none' } },
    },
    [content, diff],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-warning/30 bg-warning/10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <History className="text-warning size-4 shrink-0" />
        <p className="text-fg flex-1 text-sm">
          {formatDay(version.created_at)} {formatTime(version.created_at)} 버전을 보고 있습니다.
          <span className="text-muted">
            {' '}
            {version.author?.name ?? '알 수 없음'} 편집 · 읽기 전용
          </span>
          {diff && (
            <span className="text-muted">
              {' · 바로 앞 버전에서 '}
              {diff.added + diff.removed === 0 ? (
                titleChanged ? (
                  '제목만 바뀜'
                ) : (
                  '바뀐 곳 없음'
                )
              ) : (
                <>
                  <span className="text-success font-medium">추가 {diff.added}</span>{' '}
                  <span className="text-danger font-medium">삭제 {diff.removed}</span>
                </>
              )}
            </span>
          )}
        </p>
        <Button size="sm" onClick={onRestore} disabled={restoring}>
          <RotateCcw className="size-4" />이 버전으로 되돌리기
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="미리보기 닫기">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={tableBleedRef} className={cn('mx-auto px-6 py-8', widthClass)}>
          {titleChanged && (
            <p className="text-danger bg-danger/10 w-fit rounded-sm px-1 text-sm line-through">
              {before.title || '제목 없는 문서'}
            </p>
          )}
          <h1
            className={cn(
              'text-fg py-2 text-3xl font-bold tracking-tight',
              titleChanged && 'bg-success/10 w-fit rounded-sm px-1',
            )}
          >
            {content.title || '제목 없는 문서'}
          </h1>
          <div className="mt-4">{editor && <EditorContent editor={editor} />}</div>
        </div>
      </div>
    </div>
  )
}
