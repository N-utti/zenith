import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 표. 게시판 목록 · 팀 근태 그리드 · 승인 대기함이 쓸 자리다(청사진 §4.2).
 *
 * **열 정의 배열이 아니라 조합 부품으로 둔다.** 아직 실제 소비 화면이 없어서,
 * 지금 `columns={[...]}` API를 확정하면 게시판이 필요로 하는 모양(마스킹 행,
 * 등급 배지, 고정 열)을 추측으로 맞추게 된다. 세 화면이 붙고 나서 반복이 보이면
 * 그때 데이터 주도 래퍼를 이 위에 얹는다.
 *
 * `<table>` 시맨틱은 유지한다. div 그리드로 만들면 스크린리더가 행·열 관계를 잃는다.
 */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // 좁은 화면에서 표가 페이지를 밀어내지 않도록 자기 안에서 가로로 구른다.
    <div className="border-line bg-surface overflow-x-auto rounded-xl border">
      {/* min-w-max 가 없으면 w-full 때문에 표가 컨테이너를 넘는 일이 없어 가로 스크롤이 영영
          생기지 않는다. 대신 열이 짜부라져 긴 제목이 한 글자씩 세로로 쏟아진다(375px 결재함).
          둘을 같이 두면 넓은 화면에서는 100%, 좁은 화면에서는 내용 폭만큼이 된다. */}
      <table className={cn('w-full min-w-max border-collapse text-left text-sm', className)}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-line bg-sunken border-b">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TR({
  className,
  muted,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & {
  /** 권한 밖 행처럼 존재는 보이되 흐려야 하는 줄 (§7). */
  muted?: boolean
}) {
  return (
    <tr
      className={cn(
        'border-line border-b last:border-0',
        muted ? 'opacity-55' : 'hover:bg-surface-hover transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  )
}

type SortDir = 'asc' | 'desc' | null

export function TH({
  className,
  sort,
  onSort,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  /** 정렬 상태. `null`이면 정렬 가능하지만 지금은 기준이 아니라는 뜻. */
  sort?: SortDir
  onSort?: () => void
}) {
  const label = <span className="truncate">{children}</span>

  return (
    <th
      scope="col"
      // 정렬 중인 열만 aria-sort를 갖는다. 전부 붙이면 스크린리더가 매번 읽는다.
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
      className={cn('text-muted px-4 py-2.5 text-xs font-semibold', className)}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="hover:text-fg flex cursor-pointer items-center gap-1 transition-colors"
        >
          {label}
          {sort === 'asc' && <ChevronUp className="size-3.5" />}
          {sort === 'desc' && <ChevronDown className="size-3.5" />}
        </button>
      ) : (
        label
      )}
    </th>
  )
}

export function TD({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('text-fg px-4 py-3', className)} {...props}>
      {children}
    </td>
  )
}

/** 행이 없을 때. 표 밖에 문구를 두면 헤더만 떠 있어 고장처럼 보인다. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-subtle px-4 py-10 text-center text-sm">
        {children}
      </td>
    </tr>
  )
}
