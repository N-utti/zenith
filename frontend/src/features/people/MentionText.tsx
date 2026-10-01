import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { internalPath, splitLinks } from '@/lib/links'
import { serverOrigin } from '@/lib/serverOrigin'
import { splitMentions } from './mentions'

const LINK = 'text-accent underline underline-offset-2 hover:no-underline'

/** 본문 속 주소 하나. 제니스 안이면 라우터로 옮기고, 바깥이면 새 탭으로 연다. */
function BodyLink({ href }: { href: string }) {
  const path = internalPath(href, [location.origin, serverOrigin()])
  if (path) {
    return (
      <Link to={path} className={LINK}>
        {href}
      </Link>
    )
  }
  // 데스크탑 셸에서는 `installExternalLinkHandler` 가 가로채 기본 브라우저로 넘긴다.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {href}
    </a>
  )
}

/**
 * 본문의 `@이름` 을 배지로(05 SCR-02·SCR-04 멘션 파란 배지), 주소를 링크로. 문서 댓글과 채팅
 * 메시지가 같이 쓴다. `names` 에 있는 이름만 칠한다. 서버가 알림을 만드는 사람과 맞춰, 목록에서
 * 한 번 만들어 넘긴다(댓글은 `useMentionNames`, 채팅은 채널 멤버).
 */
export function MentionText({ body, names }: { body: string; names: ReadonlySet<string> }) {
  return splitMentions(body, names).map((part, i) =>
    part.mention ? (
      <Badge key={i} tone="accent" className="px-1 py-0 text-[length:inherit]">
        {part.text}
      </Badge>
    ) : (
      splitLinks(part.text).map((piece, j) =>
        piece.href ? <BodyLink key={`${i}-${j}`} href={piece.href} /> : piece.text,
      )
    ),
  )
}
