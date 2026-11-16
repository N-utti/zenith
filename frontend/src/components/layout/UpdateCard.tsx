import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { findUpdate, installUpdate } from '@/lib/desktop'

/** 켜 둔 채로 쓰는 앱이라 켤 때 한 번으로는 모자라다. 이 간격으로 다시 본다. */
const CHECK_EVERY_MS = 30 * 60 * 1000

/**
 * 데스크탑 앱의 새 버전 알림. 오른쪽 아래에 떠 있고 하던 일을 막지 않는다.
 *
 * 전에는 켤 때 확인 창(`confirm`)으로 물었다. 창이 답을 받을 때까지 화면이 멈추고, 하루 내내 켜 두는
 * 사람은 다음에 켤 때까지 새 버전을 모른다. 그래서 주기적으로 보고 카드로 알린다.
 * 닫으면 그 버전은 이번 실행 동안 다시 띄우지 않는다. 다음에 켜면 다시 알린다.
 * 브라우저에서는 `findUpdate` 가 늘 null 이라 아무것도 그리지 않는다.
 */
export function UpdateCard() {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const check = () =>
      void findUpdate().then((found) => {
        if (alive && found) setVersion(found)
      })
    check()
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  if (!version || version === dismissed) return null

  const install = async () => {
    setInstalling(true)
    setFailed(false)
    try {
      // 성공하면 여기서 앱이 닫힌다. 돌아왔다면 받지 못했거나 설치를 시작하지 못한 것이다.
      await installUpdate()
    } catch (error) {
      console.warn('업데이트 설치 실패', error)
      setFailed(true)
    }
    setInstalling(false)
  }

  return (
    <section
      role="status"
      aria-label="업데이트 가능"
      // 모달·명령 팔레트(z-50)보다 아래. 알림이 입력을 가리면 안 된다(토스트와 같은 층).
      className="border-line bg-surface fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-fg text-sm font-semibold">업데이트 가능</h2>
        <button
          type="button"
          aria-label="닫기"
          className="text-muted hover:text-fg -mt-1 -mr-1 cursor-pointer rounded-md p-1"
          onClick={() => setDismissed(version)}
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-fg mt-2 text-sm break-keep">제니스 v{version} 이 준비되었습니다.</p>
      <p className="text-muted mt-1 text-xs break-keep">
        설치하는 동안 앱이 닫혔다가 다시 열립니다. 관리자 확인 창이 뜨면 허용해 주세요.
      </p>
      {failed && (
        <p className="text-danger mt-2 text-xs break-keep">
          업데이트를 받지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      <Button className="mt-3 w-full" size="sm" disabled={installing} onClick={() => void install()}>
        {installing ? '받는 중...' : '업데이트'}
      </Button>
    </section>
  )
}
