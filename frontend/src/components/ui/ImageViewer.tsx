import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { AuthImg, DownloadLink } from '@/components/ui/AuthMedia'
import { useFocusTrap } from '@/lib/useFocusTrap'

const BAR_BUTTON =
  'text-subtle hover:bg-surface-hover hover:text-fg grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors'

/**
 * 그림 한 장을 창 가득 크게 본다. Esc, 닫기 버튼, 그림 바깥 어두운 자리를 누르면 닫힌다.
 * 포커스 가둠과 닫은 뒤 열었던 자리로 돌아가기는 `Modal` 과 같은 훅이 한다.
 *
 * ponytail: 확대·끌어 옮기기와 앞뒤 그림 넘기기는 없다. 창보다 큰 그림은 창에 맞춰 줄여 보이고,
 * 원본 크기는 내려받아 본다. 한 메시지에 사진을 여러 장 올리는 일이 잦아지면 넘기기부터 붙인다.
 */
export function ImageViewer({
  path,
  name,
  onClose,
}: {
  /** 서버 파일 주소(`/api/...`). */
  path: string
  name: string
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, panelRef, onClose)

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col outline-none"
    >
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        // fixed: 아이폰 사파리가 시간 표시 줄도 같이 어둡게 칠한다(Modal 의 그림자 주석).
        className="fixed inset-0 cursor-zoom-out bg-black/80"
      />

      <header className="border-line bg-surface relative flex items-center gap-1 border-b py-1.5 pr-2 pl-4">
        {/* 닫기가 DOM 에서 먼저다. 열리면 첫 요소가 초점을 받는데, 그게 내려받기면 Enter 한 번에 파일이 받아진다. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className={`${BAR_BUTTON} order-last`}
        >
          <X className="size-4" />
        </button>
        <p className="text-fg min-w-0 flex-1 truncate text-sm">{name}</p>
        <DownloadLink
          path={path}
          name={name}
          aria-label={`${name} 내려받기`}
          title="내려받기"
          className={BAR_BUTTON}
        >
          <Download className="size-4" />
        </DownloadLink>
      </header>

      {/* 그림 둘레의 빈 자리는 누름을 받지 않고 뒤의 닫기 자리로 흘려보낸다. */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-center justify-center p-4">
        <AuthImg
          path={path}
          alt={name}
          // 첨부는 캐시되지 않아 여기서 다시 받는다. 그 사이 지워졌거나 못 받으면 깨진 그림 대신 닫는다.
          onError={onClose}
          className="pointer-events-auto max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    </div>,
    document.body,
  )
}
