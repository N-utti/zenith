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
export function Table({
  className,
  scrollLabel,
  children,
}: {
  className?: string
  /**
   * 열을 줄바꿈 없이 한 줄로 세우고, 좁아지면 표가 자기 안에서 가로로 구르게 한다.
   *
   * 기본값(주지 않음)은 `w-full` 이라 표가 컨테이너를 넘지 않는다. 열이 짜부라지는 대신
   * 셀 안에서 줄바꿈된다. 게시판처럼 좁은 폭에서 열을 접고 제목을 두세 줄로 흘리도록
   * 설계한 화면이 이 동작에 기대고 있다.
   *
   * 반대로 결재함처럼 한 줄로 읽혀야 하는 표는 짜부라지면 제목이 한 글자씩 세로로 쏟아진다.
   * 그런 화면만 이 값을 준다. **폭이 아니라 내용 길이가 기준이므로** 넓은 화면에서도 내용이
   * 길면 구른다. 값은 스크린리더가 읽을 표 이름이다. 구르는 상자는 안에 포커스 받을 것이
   * 없으면 키보드로 넘길 수 없어서, 영역 자체가 포커스를 받아야 한다
   * (`CompanyAttendanceSection` 과 같은 처리).
   */
  scrollLabel?: string
  children: ReactNode
}) {
  return (
    <div
      {...(scrollLabel ? { tabIndex: 0, role: 'region', 'aria-label': scrollLabel } : {})}
      className={cn(
        'border-line bg-surface overflow-x-auto rounded-xl border',
        scrollLabel && 'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <table
        className={cn(
          'w-full border-collapse text-left text-sm',
          scrollLabel && 'min-w-max',
          className,
        )}
      >
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
