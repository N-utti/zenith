import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Paperclip } from 'lucide-react'
import { DownloadLink } from '@/components/ui/AuthMedia'
import { cn } from '@/lib/cn'
import { cleanName, formatBytes, splitExt } from '@/lib/format'
import { uploadedFilePath } from '@/lib/links'

/** 파일 하나. 채팅·결재의 첨부 칩과 같은 모양이고, 누르면 내려받는다. */
export function FileChipView({ node, selected }: NodeViewProps) {
  // 속성은 붙여넣은 HTML 이나 남의 편집(Y.Doc)에서도 온다. 타입을 믿지 않는다.
  // 글자가 아닌 값을 그대로 그리면 이 문서가 누구에게도 안 열린다.
  const name = typeof node.attrs.name === 'string' ? cleanName(node.attrs.name) : ''
  const size = Number(node.attrs.size) || 0
  const path = uploadedFilePath(node.attrs.src)

  const [stem, ext] = splitExt(name)
  const label = (
    <>
      <Paperclip className="size-3.5 shrink-0" />
      <span className="flex min-w-0">
        <span className="max-w-48 truncate">{stem}</span>
        <span className="shrink-0">{ext}</span>
      </span>
      <span className="text-subtle shrink-0">{formatBytes(size)}</span>
    </>
  )

  return (
    <NodeViewWrapper
      as="span"
      data-type="fileChip"
      title={name}
      // 글줄 높이(leading-7)를 밀지 않게 위아래만 얇다.
      className={cn(
        'border-line text-muted mx-0.5 inline-flex max-w-full items-center rounded-lg border px-2 py-0.5 align-middle text-xs',
        selected ? 'bg-accent-soft' : 'bg-sunken',
      )}
    >
      {path ? (
        <DownloadLink
          // 저장된 값은 상대경로다. 서버 주소는 그릴 때만 붙인다(사진 블록과 같은 이유).
          path={path}
          name={name}
          // 링크를 끌면 브라우저가 주소 글자를 본문에 떨어뜨린다.
          draggable={false}
          className="text-muted hover:text-fg flex min-w-0 items-center gap-1.5 no-underline transition-colors"
        >
          {label}
        </DownloadLink>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">{label}</span>
      )}
    </NodeViewWrapper>
  )
}
