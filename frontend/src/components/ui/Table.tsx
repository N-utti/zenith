import { useEffect, useRef, useState } from 'react'
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
  label,
  wide,
  children,
}: {
  className?: string
  /**
   * 표 이름. 늘 `<caption>` 으로 들어가고(화면에는 안 보인다), 좁아져서 표가 구르기 시작하면
   * 스크롤 상자도 이 이름을 단 영역이 된다.
   *
   * 구르는 상자는 안에 포커스 받을 것이 없으면 키보드로 넘길 수 없다. 오른쪽 열을 마우스
   * 없이는 볼 방법이 사라진다(WCAG 2.1.1). 그래서 구르는 동안만 상자 자신이 포커스를 받고,
   * 이름 없는 포커스 정지는 스크린리더에서 «그룹» 으로만 읽히므로 이름을 같이 준다.
   * `CompanyAttendanceSection` 이 공용 표를 안 쓰고 직접 하던 처리가 이것이다.
   *
   * 필수다. 선택으로 두면 이름 없는 포커스 정지가 조용히 만들어진다. 컴파일도 통과하고
   * 런타임 경고도 없어서, 타입이 막아 주지 않으면 아무도 눈치채지 못한다.
   */
  label: string
  /**
   * 열을 줄바꿈 없이 한 줄로 세운다.
   *
   * 기본값은 `w-full` 이라 좁아지면 열이 짜부라지고 셀 안에서 줄바꿈된다. 게시판처럼 좁은
   * 폭에서 열을 접고 제목을 두세 줄로 흘리도록 설계한 화면이 그 동작에 기대고 있다.
   * 반대로 결재함처럼 한 줄로 읽혀야 하는 표는 짜부라지면 제목이 한 글자씩 세로로 쏟아진다.
   * 그런 화면만 켠다. **폭이 아니라 내용 길이가 기준이라** 넓은 화면에서도 내용이 길면 구른다.
   */
  wide?: boolean
  children: ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [scrollable, setScrollable] = useState(false)

  /**
   * 지금 실제로 구르고 있는지 본다. 넘치지도 않는데 늘 포커스를 받게 하면 데스크톱에서
   * 표 개수만큼 탭 정지가 늘어난다. 폭은 창 크기뿐 아니라 행이 늘거나 줄어도 바뀌므로
   * 상자와 표를 같이 지켜본다.
   */
  useEffect(() => {
    const box = boxRef.current
    const table = tableRef.current
    if (!box || !table) return

    const check = () =>
      setScrollable(
        // 이 상자가 지금 포커스를 쥐고 있으면 탭 정지를 뺏지 않는다. 창을 넓히거나 브라우저를
        // 확대하는 순간 tabindex 가 사라지면 포커스가 body 로 떨어지고, 다음 Tab 이 문서 맨
        // 위에서 다시 시작해 여기까지 오던 이동이 통째로 날아간다.
        (prev) =>
          (prev && box === document.activeElement) ||
          // scrollWidth·clientWidth 는 정수로 반올림된 값이라, 열 폭이 소수로 떨어지면 안
          // 구르는데도 1 차이가 난다. 그 1px 로 탭 정지가 도로 늘어나지 않게 여유를 둔다.
          box.scrollWidth - box.clientWidth > 1,
      )

    check()
    const observer = new ResizeObserver(check)
    observer.observe(box)
    observer.observe(table)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      {...(scrollable ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}
      className={cn(
        'border-line bg-surface overflow-x-auto rounded-xl border',
        scrollable && 'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <table
        ref={tableRef}
        className={cn('w-full border-collapse text-left text-sm', wide && 'min-w-max', className)}
      >
        {/* 구르지 않는 폭에서는 위 aria-label 이 붙지 않는다. 표 자체의 이름은 여기서 준다.
            스크린리더의 표 목록·표 단축키 이동이 이 이름을 읽는다. */}
        <caption className="sr-only">{label}</caption>
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
