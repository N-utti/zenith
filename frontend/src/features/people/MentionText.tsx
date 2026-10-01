import { Link } from 'react-router'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { UNTITLED_DOC, useTree } from '@/features/docs/api'
import { docIdOf, internalPath, splitLinks } from '@/lib/links'
import { serverOrigin } from '@/lib/serverOrigin'
import { splitMentions } from './mentions'

// 밑줄은 올렸을 때와 키보드로 옮겼을 때만. 본문에 주소가 여럿이면 밑줄이 글보다 먼저 눈에
// 들어온다.
const LINK = 'text-accent underline-offset-2 hover:underline focus-visible:underline'

/**
 * 제니스 문서를 가리키는 주소. 주소 대신 문서 제목을 칩으로 보여 준다.
 *
 * 제목은 사이드바가 이미 받아 둔 문서 트리에서 꺼낸다. 문서를 하나씩 조회하면 주소마다 본문
 * (Yjs 상태)까지 통째로 받는다. 트리에 없으면(휴지통, 없는 id, 아직 못 받음) 주소를 그대로 둔다.
 */
function DocLink({ href, path, docId }: { href: string; path: string; docId: string }) {
  const doc = useTree().data?.docs.find((item) => item.id === docId)
  if (!doc) {
    return (
      <Link to={path} className={LINK}>
        {href}
      </Link>
    )
  }
  return (
    <Link
      to={path}
      // 칩이 되면 댓글이나 해시로 가는 주소인지 안 보인다. 올리면 원래 주소가 뜬다.
      title={href}
      // box-decoration-clone: 제목이 줄을 넘겨도 줄마다 모서리와 여백이 붙는다.
      className="bg-sunken text-fg hover:bg-surface-hover rounded box-decoration-clone px-1 py-0.5 font-medium transition-colors"
    >
      <FileText className="text-subtle mr-1 inline size-3.5 align-[-2px]" aria-hidden />
      <span className="sr-only">문서: </span>
      {doc.title || UNTITLED_DOC}
    </Link>
  )
}

/** 본문 속 주소 하나. 제니스 안이면 라우터로 옮기고, 바깥이면 새 탭으로 연다. */
function BodyLink({ href }: { href: string }) {
  const path = internalPath(href, [location.origin, serverOrigin()])
  if (path) {
    const docId = docIdOf(path)
    if (docId) return <DocLink href={href} path={path} docId={docId} />
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
