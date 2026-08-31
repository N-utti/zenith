import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

/**
 * 권한 밖 항목 한 줄 (FR-BRD-03).
 *
 * **목록에서 지우지 않는다** — 존재는 보이되 들어갈 수 없어야 한다.
 * 지워 버리면 "그런 글이 있다"는 사실까지 감추게 되고, 그건 PRD가 정한 규약이 아니다.
 *
 * 세 곳이 같은 규약을 쓴다: 홈 공지 카드 · 사이드바 게시판 섹션 · 게시판 목록.
 * 레이아웃은 셋이 다르므로 이 부품은 **껍데기만** 맡는다 — 흐림·클릭 차단·`aria-disabled`.
 * 안에 무엇을 그릴지는 호출부가 정한다.
 */
export function MaskedRow({
  masked,
  to,
  onNavigate,
  className,
  children,
}: {
  masked?: boolean
  /** 열람 가능할 때 이동할 곳. 없으면 링크가 아닌 그냥 행이 된다. */
  to?: string
  /** 이동 시 곁들일 동작 (모바일 드로어 닫기 등). 마스킹된 행에서는 호출되지 않는다. */
  onNavigate?: () => void
  className?: string
  children: ReactNode
}) {
  if (masked) {
    return (
      <div
        aria-disabled
        title="열람 권한이 없습니다"
        className={cn('cursor-not-allowed opacity-55', className)}
      >
        {children}
      </div>
    )
  }

  if (to) {
    return (
      <Link
        to={to}
        onClick={onNavigate}
        className={cn('hover:bg-surface-hover transition-colors', className)}
      >
        {children}
      </Link>
    )
  }

  return <div className={className}>{children}</div>
}

/** 마스킹된 행의 본문 자리에 들어가는 문구. 작성자·시각 대신 이것이 보인다. */
export function MaskedNote() {
  return <span className="text-subtle">열람 권한 없음</span>
}
