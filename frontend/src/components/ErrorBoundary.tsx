import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
  children: ReactNode
  /**
   * 셸(상단바·사이드바) 안쪽 본문만 감쌀 때. 나머지 메뉴가 살아 있으므로 이 화면만 다시 그린다.
   * 끄면 셸까지 죽은 상황이라 새로고침만 남는다.
   */
  inline?: boolean
}

/**
 * React 는 렌더·effect 에서 던진 예외를 잡아 줄 바운더리가 없으면 트리 전체를 내린다.
 * 부품 하나가 화면 전부를 검게 만드는 일(#137 명령 팔레트, 09-16 게시글 상세)을 여기서 끊는다.
 *
 * React 19 에도 함수형 바운더리는 없다. 클래스가 유일한 방법이라 이 파일만 클래스다.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 온프레미스라 밖으로 보낼 곳이 없다. 사용자가 콘솔을 열어 알려주는 것이 유일한 보고 경로다.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid h-full place-items-center px-4 py-20 text-center">
        <div>
          <h1 className="text-fg text-xl font-semibold">화면을 그리지 못했습니다</h1>
          <p className="text-muted mt-1 text-sm">
            {this.props.inline
              ? '이 화면에서만 생긴 문제입니다. 다른 메뉴는 그대로 쓸 수 있습니다.'
              : '새로고침하면 대부분 돌아옵니다.'}
          </p>
          {/* 사내툴이고 오류를 모아 보는 곳이 없다. 무엇이 터졌는지는 사용자가 전해 줘야 한다. */}
          <p className="text-subtle mt-4 font-mono text-xs break-all">{error.message}</p>
          <Button
            variant="secondary"
            className="mt-6"
            onClick={() => {
              if (this.props.inline) this.setState({ error: null })
              else window.location.reload()
            }}
          >
            {this.props.inline ? '이 화면 다시 그리기' : '새로고침'}
          </Button>
        </div>
      </div>
    )
  }
}
