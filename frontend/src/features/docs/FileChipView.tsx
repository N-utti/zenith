import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Paperclip } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError, apiBytes } from '@/lib/api'
import { cn } from '@/lib/cn'
import { downloadBytes } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { uploadedFilePath } from '@/lib/links'
import { httpUrl } from '@/lib/serverOrigin'

/**
 * 보이는 이름과 받는 파일이 달라 보이게 만드는 글자: 제어 문자, 폭 없는 공백, 글자 방향 제어.
 * `lib/links.ts` 가 주소에서 빼는 것과 같은 집합이다.
 */
const HIDDEN = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu

/** 파일 하나. 채팅·결재의 첨부 칩과 같은 모양이고, 누르면 내려받는다. */
export function FileChipView({ node, selected }: NodeViewProps) {
  // 속성은 붙여넣은 HTML 이나 남의 편집(Y.Doc)에서도 온다. 타입을 믿지 않는다.
  // 글자가 아닌 값을 그대로 그리면 이 문서가 누구에게도 안 열린다.
  const name = typeof node.attrs.name === 'string' ? node.attrs.name.replace(HIDDEN, '') : ''
  const size = Number(node.attrs.size) || 0
  const path = uploadedFilePath(node.attrs.src)
  const toast = useToast()

  /*
   * 링크를 그대로 따라가게 두지 않고 앱이 내용을 받아 저장시킨다(CRM 내보내기와 같은 길).
   * 링크 이동은 로그인 만료 갱신을 타지 않고, 데스크탑 셸에서는 오리진이 달라 `download` 의
   * 파일 이름이 무시된다. 개발 중에는 목(서비스워커)이 이동 요청을 건너뛰어 빈 파일이 저장된다.
   */
  const download = async (event: MouseEvent) => {
    event.preventDefault()
    if (!path) return
    try {
      const bytes = await apiBytes(path.slice('/api'.length))
      downloadBytes(name || '파일', bytes, 'application/octet-stream')
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : '파일을 내려받지 못했습니다.')
    }
  }

  // 확장자는 자르지 않는다. 긴 이름 뒤에 숨은 `.bat` 이 말줄임에 가려지면 안 된다.
  const dot = name.lastIndexOf('.')
  const [stem, ext] =
    dot > 0 && name.length - dot <= 12 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
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
        <a
          // 저장된 값은 상대경로다. 서버 주소는 그릴 때만 붙인다(사진 블록과 같은 이유).
          href={httpUrl(path)}
          download={name}
          onClick={download}
          // 링크를 끌면 브라우저가 주소 글자를 본문에 떨어뜨린다.
          draggable={false}
          className="text-muted hover:text-fg flex min-w-0 items-center gap-1.5 no-underline transition-colors"
        >
          {label}
        </a>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">{label}</span>
      )}
    </NodeViewWrapper>
  )
}
