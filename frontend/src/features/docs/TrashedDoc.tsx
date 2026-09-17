import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { formatDay } from '@/lib/datetime'
import { UNTITLED_DOC, untrashDoc } from './api'
import { purgeAt, type DocDetail } from './types'

/**
 * 휴지통에 든 문서를 열었을 때. 편집기를 주지 않는다.
 *
 * 서버는 휴지통 문서도 읽게 해 주지만(되돌리기 전에 확인할 수 있어야 한다) **쓰기는 전부
 * 404 다**. 편집기를 그대로 띄우면 사용자는 평소처럼 타이핑하고, 제목·버전은 서버에 못 가고
 * 본문은 이 브라우저에만 쌓인다. 공동편집 릴레이도 끊겨 "오프라인 편집 중" 이라는 엉뚱한
 * 안내가 뜬다.
 *
 * 되돌리는 상시 경로는 휴지통 화면(`/docs/trash`)이다. 여기는 문서 주소로 바로 들어왔을 때의
 * 자리고, 되돌리기 버튼을 같이 둔다. 옮긴 직후 토스트의 되돌리기는 10초면 사라진다.
 */
export function TrashedDoc({ meta }: { meta: DocDetail }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [restoring, setRestoring] = useState(false)

  const restore = () => {
    setRestoring(true)
    untrashDoc(meta.id)
      .then(() => {
        toast.success('문서를 되돌렸습니다.')
        void navigate(`/docs/${meta.id}`, { replace: true })
      })
      .catch((err: unknown) => {
        setRestoring(false)
        toast.error(err instanceof ApiError ? err.message : '되돌리지 못했습니다.')
      })
  }

  return (
    <div className="grid h-full place-items-center px-6 py-20 text-center">
      <div className="max-w-sm">
        <span className="bg-sunken text-subtle mx-auto grid size-12 place-items-center rounded-xl">
          <Trash2 className="size-5" />
        </span>

        <h1 className="text-fg mt-4 text-lg font-semibold">{meta.title || UNTITLED_DOC}</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          휴지통에 있습니다. 되돌리기 전에는 고칠 수 없습니다.
          {meta.deleted_at && (
            <>
              <br />
              <strong className="text-fg">
                {formatDay(purgeAt(meta.deleted_at).toISOString())}
              </strong>
              에 영구 삭제됩니다.
            </>
          )}
        </p>

        <div className="mt-5 flex items-center justify-center gap-2">
          <Button size="sm" onClick={restore} disabled={restoring}>
            {restoring ? <Spinner className="border-t-on-accent" /> : '되돌리기'}
          </Button>
          <Link
            to="/docs"
            className="text-muted hover:text-fg rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            문서 목록으로
          </Link>
        </div>
      </div>
    </div>
  )
}
