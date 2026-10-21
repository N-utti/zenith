import { Maximize2, X } from 'lucide-react'
import { useNavigate } from 'react-router'

/**
 * 화면을 나눠 오른쪽에 연 문서의 버튼 둘. 크게 열면 그 문서만 남고(옆 패널도 돌아온다), 닫으면 왼쪽만 남는다.
 * 문서를 못 불러온 자리(권한 없음·없음·휴지통·오류)에서도 닫을 수 있게 따로 꺼내 둔다. 편집기(tiptap)를 끌어오지
 * 않는 파일이라 AppLayout 이 첫 화면 묶음에 실어도 가볍다.
 */
export function SplitActions({ docId, onClose }: { docId: string; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <>
      <button
        type="button"
        aria-label="이 문서만 크게 열기"
        title="크게 열기"
        onClick={() => {
          // 크게 열면 왼쪽(본 화면)에 그 문서가 뜬다. 오른쪽에 같은 문서가 남지 않게 먼저 닫는다.
          onClose()
          void navigate(`/docs/${docId}`)
        }}
        className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded transition-colors"
      >
        <Maximize2 className="size-4" />
      </button>
      <button
        type="button"
        aria-label="오른쪽 문서 닫기"
        title="닫기"
        onClick={onClose}
        className="text-subtle hover:text-fg grid size-7 cursor-pointer place-items-center rounded transition-colors"
      >
        <X className="size-4" />
      </button>
    </>
  )
}
