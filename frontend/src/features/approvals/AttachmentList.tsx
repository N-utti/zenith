import { Paperclip, X } from 'lucide-react'
import { DownloadLink } from '@/components/ui/AuthMedia'
import { formatBytes } from '@/lib/format'

interface Item {
  name: string
  size: number
  /** 아직 안 올린 파일은 없다. 그때는 내려받을 수 없어 이름만 보인다. */
  url?: string
}

/**
 * 첨부 칩. 결재 문서와 게시글이 같이 쓴다. 내려받기는 쿠키로 인증되고 서버가 그 문서(게시판)의
 * 열람 권한으로 다시 판정한다.
 * ponytail: 미리보기 없이 칩만. 영수증 사진은 눌러서 받는다. 채팅처럼 그림을 펼치려면 `isImage` 를 가져온다.
 */
export function AttachmentList({
  files,
  onRemove,
}: {
  files: Item[]
  onRemove?: (index: number) => void
}) {
  if (files.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file, index) => {
        const label = (
          <>
            <Paperclip className="size-3.5 shrink-0" />
            <span className="max-w-48 truncate">{file.name}</span>
            <span className="text-subtle">{formatBytes(file.size)}</span>
            {!file.url && <span className="text-subtle">· 올리기 전</span>}
          </>
        )
        return (
          <li
            key={`${file.url ?? file.name}-${index}`}
            className="border-line bg-sunken text-muted flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
          >
            {file.url ? (
              <DownloadLink
                path={file.url}
                name={file.name}
                className="hover:text-fg flex items-center gap-1.5 transition-colors"
              >
                {label}
              </DownloadLink>
            ) : (
              label
            )}
            {onRemove && (
              <button
                type="button"
                aria-label={`${file.name} 떼기`}
                onClick={() => onRemove(index)}
                className="text-subtle hover:text-fg cursor-pointer"
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
