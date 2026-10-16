import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '@/lib/cn'
import { uploadedFilePath } from '@/lib/links'
import { AuthImg } from '@/components/ui/AuthMedia'

const MIN_WIDTH = 96

/** 사진 한 장 + 캡션. 오른쪽 아래 손잡이를 끌면 폭이 바뀐다. */
export function ImageBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { src, alt, width } = node.attrs as {
    src: string
    alt: string | null
    width: number | null
  }
  const frameRef = useRef<HTMLDivElement>(null)
  // 끄는 동안은 화면만 바꾸고, 손을 뗄 때 한 번만 문서에 쓴다.
  // 매 픽셀마다 쓰면 Yjs 업데이트와 버전 기록이 폭주한다.
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  const startResize = (event: ReactPointerEvent) => {
    const image = frameRef.current?.querySelector('img')
    const limit = frameRef.current?.getBoundingClientRect().width
    if (!image || !limit) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = image.getBoundingClientRect().width
    const widthAt = (clientX: number) =>
      Math.round(Math.min(Math.max(startWidth + clientX - startX, MIN_WIDTH), limit))

    const onMove = (move: PointerEvent) => setDragWidth(widthAt(move.clientX))
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragWidth(null)
      updateAttributes({ width: widthAt(up.clientX) })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const shownWidth = dragWidth ?? width
  // 올린 파일 주소만 그린다. 남의 편집이나 버전 미리보기로 바깥 주소가 와도 부르지 않는다
  // (데스크톱 앱에서는 그대로 바깥으로 요청이 나간다).
  const path = uploadedFilePath(src)

  return (
    // 노드 뷰는 renderHTML 을 거치지 않는다. 댓글 닻(blockId.ts)이 DOM 에서 찾을 수 있게 직접 싣는다.
    <NodeViewWrapper
      as="figure"
      className="zenith-image group"
      data-type="imageBlock"
      data-block-id={(node.attrs.blockId as string | null) ?? undefined}
    >
      <div ref={frameRef} contentEditable={false} className="relative w-full">
        <span className="relative inline-block max-w-full align-bottom">
          {path ? (
            <AuthImg
              // 문서에 저장된 src는 `/api/files/{id}` 상대경로다. 서버 주소는 저장하지
              // 않는다. 서버가 옮겨 가면 저장된 문서가 전부 깨지기 때문이다. 대신
              // 화면에 그릴 때만 오리진을 붙인다(데스크탑 셸에서만 값이 붙는다).
              path={path}
              alt={alt ?? ''}
              draggable={false}
              style={shownWidth ? { width: `${shownWidth}px` } : undefined}
              className={cn(
                'block h-auto max-w-full rounded-lg',
                selected && 'ring-accent ring-2 ring-offset-2 ring-offset-[var(--color-surface)]',
              )}
            />
          ) : (
            <span className="bg-sunken text-subtle block rounded-lg px-4 py-6 text-xs">
              표시할 수 없는 사진입니다
            </span>
          )}

          {editor.isEditable && path && (
            <span
              role="separator"
              aria-label="사진 크기 조절"
              onPointerDown={startResize}
              className={cn(
                'border-surface bg-accent absolute right-1 bottom-1 size-3.5 cursor-nwse-resize rounded-full border-2 transition-opacity',
                dragWidth === null && !selected && 'opacity-0 group-hover:opacity-100',
              )}
            />
          )}
        </span>
      </div>

      {/* NoInfer 때문에 태그를 제네릭으로 못 박아 줘야 한다. */}
      <NodeViewContent<'figcaption'> as="figcaption" />
    </NodeViewWrapper>
  )
}
