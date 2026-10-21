import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { Forbidden } from '@/components/Forbidden'
import { Spinner } from '@/components/ui/Spinner'
import { useDoc } from '@/features/docs/api'
import { DocWorkspace, SplitActions } from '@/features/docs/DocWorkspace'
import { TrashedDoc } from '@/features/docs/TrashedDoc'
import { DOC_DRAG_TYPE, type DocSeedState } from '@/features/docs/types'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

/**
 * 문서 하나의 자리. `onClose` 가 있으면 화면을 나눠 오른쪽에 연 문서다.
 * `seed` 는 AI 답변 "문서로 저장"이 실어 보낸 초안. 문서가 비어 있는 첫 탭에서만 심긴다(DocWorkspace onCreate).
 */
function DocPane({
  docId,
  seed,
  onClose,
}: {
  docId: string
  seed?: DocSeedState | null
  onClose?: (replace?: boolean) => void
}) {
  const { data: meta, isPending, isError, error } = useDoc(docId)

  let state: ReactNode = null
  if (isPending) {
    state = (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  } else if (error instanceof ApiError && error.status === 403) {
    // 폴더 열람 권한(백엔드 #421). 링크로 들어왔거나, 편집 중에 권한이 회수돼 다시 받은 경우다
    // (`useCollabSession` 의 4403). 다시 받다 실패하면 앞서 받은 `meta` 가 남아 있어 isError 를 먼저 본다.
    state = (
      <Forbidden to="/docs" back="문서 목록으로" contact="폴더를 관리하는 임원에게">
        이 문서가 든 폴더를 볼 수 있는 권한이 없습니다.
      </Forbidden>
    )
  } else if (isError || !meta) {
    state = (
      <div className="py-20 text-center">
        <h1 className="text-fg text-lg font-semibold">
          {/* 다시 받다 실패한 서버·네트워크 오류도 여기로 온다. 404 만 「없다」고 말한다. */}
          {error instanceof ApiError && error.status !== 404
            ? '문서를 불러오지 못했습니다'
            : '문서를 찾을 수 없습니다'}
        </h1>
        <Link to="/docs" className="text-accent mt-4 inline-block text-sm hover:underline">
          문서 목록으로 →
        </Link>
      </div>
    )
  } else if (meta.deleted_at) {
    // 휴지통에 든 문서는 읽을 수만 있다(서버가 쓰기를 전부 404 로 막는다). 편집기를 띄우면
    // 타이핑이 이 브라우저에만 쌓이고 저장 실패는 아무 데도 안 보인다.
    state = <TrashedDoc meta={meta} stay={!!onClose} />
  }

  if (!state && meta) {
    // 상단 경로 줄은 DocWorkspace가 그린다. 편집자 표시가 협업 세션을 필요로 해서다.
    // docId가 바뀌면 협업 세션을 통째로 새로 연다.
    return (
      <DocWorkspace
        key={meta.id}
        meta={seed?.seedHtml ? { ...meta, ...seed } : meta}
        onCloseSplit={onClose}
      />
    )
  }
  if (!onClose) return state
  // 오른쪽에 연 문서를 못 불러와도 닫을 수 있어야 한다. 편집기의 상단 줄 자리에 버튼만 둔다.
  return (
    <>
      <div className="border-line bg-surface flex h-11 shrink-0 items-center justify-end gap-1 border-b px-4">
        <SplitActions docId={docId} onClose={() => onClose()} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{state}</div>
    </>
  )
}

const isDocDrag = (e: DragEvent) => e.dataTransfer.types.includes(DOC_DRAG_TYPE)

/**
 * 문서 편집 화면. 사이드바 트리에서 문서를 끌어 오른쪽 절반에 놓으면 화면을 나눠 그 문서를 옆에 연다.
 * 오른쪽 문서는 주소(`?split=`)에 실어서 뒤로 가기로 닫히고 링크로 그대로 건넬 수 있다.
 */
export function DocEditorPage() {
  const { docId = '' } = useParams()
  const location = useLocation()
  const seed = location.state as DocSeedState | null
  const [params, setParams] = useSearchParams()
  // 같은 문서를 둘 띄우면 한 탭에서 협업 세션 둘이 한 문서를 붙잡는다(내 커서가 남처럼 보이고 저장이 두 벌 돈다).
  // 끌어 놓기는 막지만 손으로 친 주소·건네받은 링크로도 올 수 있다.
  const splitId = params.get('split') === docId ? null : params.get('split')
  /** 트리에서 문서를 끌어 이 화면 위로 들어왔는지. 그동안 놓을 자리를 띄운다. */
  const [dropping, setDropping] = useState(false)

  // 어디에 놓든 Esc 로 그만두든 끌기가 끝나면 끝 신호가 끌던 트리 줄에서 올라온다.
  useEffect(() => {
    const off = () => setDropping(false)
    document.addEventListener('dragend', off)
    return () => document.removeEventListener('dragend', off)
  }, [])

  // 주소만 바꾸면 `location.state`(AI 초안)가 떨어진다. 왼쪽 세션이 붙기 전에 놓으면 초안이 안 심기므로 이어 준다.
  const setSplit = (id: string | null, replace = false) =>
    setParams(
      (prev) => {
        if (id) prev.set('split', id)
        else prev.delete('split')
        return prev
      },
      { replace, state: location.state },
    )

  return (
    <div
      className="relative flex h-full"
      // 본문 편집기가 끌기 신호를 먼저 가로챌 수 있어 잡는 단계에서 본다.
      onDragEnterCapture={(e) => isDocDrag(e) && setDropping(true)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
    >
      {/* 왼쪽만 옆 패널(320px)을 가진다. 그 폭을 기본 크기로 깔고 남는 폭을 반씩 나눠 두 본문 폭을 맞춘다. */}
      <div className="flex min-w-0 flex-1 basis-80 flex-col">
        <DocPane docId={docId} seed={seed} />
      </div>
      {/* ponytail: 1280px 아래에서는 두 본문이 다 좁아져 오른쪽을 감춘다(주소에는 남는다). 넓히면 다시 보인다.
          감추기만 해서 협업 연결은 남는다(동료 화면에 그 문서를 보는 것으로 뜬다). 문제가 되면 폭으로 마운트를 가른다. */}
      {splitId && (
        <div
          role="region"
          aria-label="오른쪽 문서"
          className="border-line flex min-w-0 flex-1 basis-0 flex-col border-l max-xl:hidden"
        >
          <DocPane key={splitId} docId={splitId} onClose={(replace) => setSplit(null, replace)} />
        </div>
      )}

      {dropping && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            const id = e.dataTransfer.getData(DOC_DRAG_TYPE)
            // 같은 문서를 둘 띄우면 편집기 둘이 한 문서를 붙잡는다. 왼쪽 문서는 놓아도 그대로 둔다.
            if (id && id !== docId) setSplit(id)
          }}
          // 열린 오른쪽 칸은 반보다 좁다(왼쪽 패널 320px 의 반만큼). 놓을 자리도 그 칸에 맞춘다.
          className={cn(
            'border-accent bg-surface/90 text-accent absolute inset-y-2 right-2 z-30 grid place-items-center rounded-lg border-2 border-dashed text-sm font-medium max-xl:hidden',
            splitId ? 'w-[calc(50%-10.75rem)]' : 'w-[calc(50%-0.75rem)]',
          )}
        >
          {splitId ? '여기에 놓으면 오른쪽 문서를 바꿉니다' : '여기에 놓으면 오른쪽에 엽니다'}
        </div>
      )}
    </div>
  )
}
