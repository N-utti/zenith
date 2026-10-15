import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Lock } from 'lucide-react'

/**
 * 열람 권한이 없을 때. 05 "상태·엣지 케이스"가 요구하는 **전용 403 화면**이다.
 *
 * 목록에서는 빼거나 마스킹해 막지만 주소를 직접 치거나 링크로 들어올 수 있다. 그때 빈 화면이나
 * 일반 오류를 보여주면 "고장"으로 읽힌다. 막혔다는 사실과 이유를 밝힌다.
 */
export function Forbidden({
  children,
  to,
  back,
  contact = '경영지원팀에',
}: {
  /** 왜 막혔는지. 서버 403 은 code·detail 뿐이라 어느 등급부터인지는 모른다. */
  children: ReactNode
  to: string
  back: string
  /** 권한을 줄 수 있는 곳. 조사까지(`경영지원팀에`·`임원에게`). */
  contact?: string
}) {
  return (
    // 편집 중에 권한이 회수돼 이 화면으로 바뀌기도 한다(문서 4403). 화면 읽기 사용자에게도 알린다.
    <div role="status" className="grid place-items-center py-20 text-center">
      <div className="max-w-sm">
        <span className="bg-sunken text-subtle mx-auto grid size-12 place-items-center rounded-xl">
          <Lock className="size-5" />
        </span>
        <h1 className="text-fg mt-4 text-lg font-semibold">열람 권한이 없습니다</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          {children}
          <br />
          권한이 필요하면 {contact} 문의해 주세요.
        </p>
        <Link to={to} className="text-accent mt-5 inline-block text-sm hover:underline">
          {back} →
        </Link>
      </div>
    </div>
  )
}
