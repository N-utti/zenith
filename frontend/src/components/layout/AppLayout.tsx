import { lazy, Suspense, useEffect, useState, type DragEvent } from 'react'
import { Outlet, useLocation, useParams } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { Spinner } from '@/components/ui/Spinner'
import { SplitActions } from '@/features/docs/SplitActions'
import { setSplitDoc, useSplitDoc } from '@/features/docs/splitDoc'
import { DOC_DRAG_TYPE } from '@/features/docs/types'
import { cn } from '@/lib/cn'
import { useContentWide } from '@/lib/contentWidth'
import { usePanelWidth } from '@/lib/usePanelWidth'
import { ConnectionBanner } from './ConnectionBanner'
import { Header } from './Header'
import { MobileTabBar } from './MobileTabBar'
import { Sidebar } from './Sidebar'

// 편집기(tiptap)는 무겁다. 문서 편집 화면처럼 오른쪽 문서도 띄울 때 받는다.
const SplitDocPane = lazy(() =>
  import('@/features/docs/DocPane').then((module) => ({ default: module.DocPane })),
)

const isDocDrag = (e: DragEvent) => e.dataTransfer.types.includes(DOC_DRAG_TYPE)

const COLLAPSED_KEY = 'zenith.sidebarCollapsed'

/** AppLayout 은 bleed 유무로 두 벌이라 컴포넌트 상태만으로는 화면을 옮길 때 접힘이 풀린다. 브라우저에 남긴다. */
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 12·UI 청사진 1b 셸. 상단바가 전체 폭을 잡고, 그 아래에 트리 사이드바와 본문이 나란히 선다.
 *
 * bleed: 본문 패딩과 최대폭을 없애고 스크롤을 안쪽 패널에 맡긴다.
 * 문서 에디터처럼 화면을 꽉 채우고 영역별로 따로 스크롤해야 하는 화면용.
 */
export function AppLayout({ bleed = false }: { bleed?: boolean }) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const wide = useContentWide()

  // 화면을 나눠 오른쪽에 띄운 문서(`splitDoc.ts`). 사이드바 트리에서 문서를 끌어 본문 오른쪽에 놓으면 연다.
  // 본 화면이 같은 문서면 띄우지 않는다. 한 탭에서 협업 세션 둘이 한 문서를 붙잡으면 내 커서가 남처럼 보이고
  // 저장이 두 벌 돈다. 트리에서 그 문서를 눌러 본 화면으로 옮긴 것이니 닫는다.
  const splitDoc = useSplitDoc()
  const { docId } = useParams()
  const splitId = splitDoc !== docId ? splitDoc : null
  useEffect(() => {
    if (splitDoc && splitDoc === docId) setSplitDoc(null)
  }, [splitDoc, docId])
  // 처음 폭은 1920 모니터의 문서 화면에서 두 본문이 비슷해지는 값. 창의 절반을 넘지 않는다. 60% 까지 열면
  // 사이드바·문서 패널을 빼고 왼쪽 본문이 150px 남짓으로 줄었다.
  const splitPanel = usePanelWidth('zenith.splitDocWidth', 680, 360, 1200, 0.5)
  /** 트리에서 문서를 끌어 본문 위로 들어왔는지. 그동안 놓을 자리를 띄운다. */
  const [dropping, setDropping] = useState(false)
  // 어디에 놓든 Esc 로 그만두든 끌기가 끝나면 끝 신호가 끌던 트리 줄에서 올라온다.
  useEffect(() => {
    const off = () => setDropping(false)
    document.addEventListener('dragend', off)
    return () => document.removeEventListener('dragend', off)
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // 저장 못 해도 이번 세션의 접힘은 유지된다.
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* 본문이 터져도 상단바·사이드바는 남긴다. 주소가 바뀌면 key 로 새로 만들어져 저절로 풀린다. */
  const body = (
    <ErrorBoundary key={location.pathname} inline>
      <Outlet />
    </ErrorBoundary>
  )

  return (
    <div className="bg-canvas flex h-full flex-col">
      <Header
        onOpenSidebar={() => setSidebarOpen(true)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        showWidthToggle={!bleed}
      />
      <ConnectionBanner />

      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} collapsed={collapsed} onClose={() => setSidebarOpen(false)} />

        {/* 놓을 자리를 받는 칸은 사이드바를 뺀 본문만. 트리 안에서 옮기려고 끄는 동안에는 뜨지 않는다.
            본문 편집기가 끌기 신호를 먼저 가로챌 수 있어 잡는 단계에서 본다. */}
        <div
          className="relative flex min-w-0 flex-1"
          onDragEnterCapture={(e) => isDocDrag(e) && setDropping(true)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
          }}
        >
          {/* 스크롤바 자리 비우기는 index.css 의 overflow-y-auto 전역 규칙이 맡는다.
            bleed 는 hidden 이 아니라 clip 으로 자른다. hidden 은 사용자는 못 굴려도 코드는 굴릴 수 있어서,
            넘친 안쪽(여닫는 중인 문서 패널 등)에 scrollIntoView 가 걸리면 화면 전체가 밀린 채 남는다. */}
          {/* 나눈 동안 본문은 640px 아래로 줄지 않는다(문서 화면이면 오른쪽 패널 320px 를 빼고도 본문이 남게).
              그보다 좁은 창에서는 오른쪽 칸이 대신 줄어든다(360px 까지). 손으로 정한 폭은 저장값 그대로다. */}
          <main
            className={cn(
              'min-w-0 flex-1',
              splitId && 'xl:min-w-160',
              bleed ? 'overflow-clip' : 'overflow-y-auto',
            )}
          >
            {bleed ? (
              body
            ) : (
              <div className={cn('mx-auto px-4 py-6 sm:px-6 sm:py-8', !wide && 'max-w-6xl')}>
                {body}
              </div>
            )}
          </main>

          {/* ponytail: 1280px 아래에서는 양쪽이 다 좁아져 오른쪽을 감춘다(넓히면 다시 보인다). 감추기만 해서
            협업 연결은 남는다(동료 화면에 그 문서를 보는 것으로 뜬다). 문제가 되면 폭으로 마운트를 가른다.
              ponytail: 여백 있는 화면(홈 등)과 꽉 찬 화면(채팅 등) 사이를 옮기면 AppLayout 이 다시 마운트돼 오른쪽
              문서도 새로 열린다(스크롤·되돌리기 기록이 사라진다). 같은 묶음 안에서 옮길 때는 남는다. 거슬리면
              AppLayout 을 하나로 합치고 bleed 를 주소로 가른다. */}
          {splitId && (
            <>
              <ResizeHandle
                panel={splitPanel}
                side="left"
                label="오른쪽 문서 폭"
                className="hidden xl:block"
              />
              <section
                aria-label="오른쪽 문서"
                // 채팅 입력칸이 창 전체에서 받는 파일 놓기가 이 칸에서는 비킨다(Composer).
                data-split-doc
                style={{ width: splitPanel.width, maxWidth: splitPanel.maxWidth }}
                className="border-line bg-canvas hidden min-w-90 flex-col border-l xl:flex"
              >
                {/* 오른쪽 문서가 터져도 본 화면은 남긴다. 다시 그려도 같은 오류면 새로 고쳐도 다시 뜨므로 닫게 한다. */}
                <ErrorBoundary
                  key={splitId}
                  fallback={
                    <>
                      <div className="border-line bg-surface flex h-11 shrink-0 items-center justify-end gap-1 border-b px-4">
                        <SplitActions docId={splitId} onClose={() => setSplitDoc(null)} />
                      </div>
                      <p className="text-muted px-6 py-20 text-center text-sm">
                        이 문서를 띄우지 못했습니다.
                      </p>
                    </>
                  }
                >
                  <Suspense
                    fallback={
                      <div className="grid flex-1 place-items-center">
                        <Spinner className="size-6" />
                      </div>
                    }
                  >
                    <SplitDocPane docId={splitId} onClose={() => setSplitDoc(null)} />
                  </Suspense>
                </ErrorBoundary>
              </section>
            </>
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
                // 본 화면에 열린 문서는 놓아도 그대로 둔다(위 같은 문서 두 벌).
                if (id && id !== docId) setSplitDoc(id)
              }}
              // 오른쪽 문서가 열릴(열려 있는) 폭 그대로 그린다. 어디에 뜰지 미리 보인다.
              style={{ width: `calc(min(${splitPanel.width}px, ${splitPanel.maxWidth}) - 1rem)` }}
              className="border-accent bg-surface/90 text-accent absolute inset-y-2 right-2 z-30 grid place-items-center rounded-lg border-2 border-dashed text-sm font-medium max-xl:hidden"
            >
              {splitId ? '여기에 놓으면 오른쪽 문서를 바꿉니다' : '여기에 놓으면 오른쪽에 엽니다'}
            </div>
          )}
        </div>
      </div>

      <MobileTabBar />

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
