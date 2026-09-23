import type { SearchHit } from '@/features/search/types'
import type { User } from '@/types'
import { BOARD_DEFS, canRead, POSTS } from './boardDb'
import { DOC_SEEDS, DOCS, findFolder } from './docsDb'

/**
 * ⌘K 통합검색의 목. 백엔드 `routers/search.py` 와 같은 모양을 돌려준다.
 *
 * 실제 서버는 Postgres 전문검색(토큰 접두 매칭 + 최근성 랭킹)을 쓴다. 여기서는 소문자 부분
 * 일치로 대신한다. 목이 랭킹을 흉내 내 봐야 화면이 검증할 수 있는 건 "맞는 것이 나오는가" 와
 * "권한 밖이 빠지는가" 뿐이다.
 *
 * **채팅은 검색되지 않는다.** 메시지는 MSW 가 아니라 개발 릴레이(`scripts/chat.js`)의 다른
 * 프로세스에 있다. 실제 백엔드에 붙으면 그때 함께 나온다.
 */

/** 백엔드가 그러듯 `<>&` 를 엔티티로 바꾼다. 화면이 되돌려 글자로 그린다. */
function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 본문에서 일치 부분을 찾아 앞뒤를 잘라 준다. 일치는 `**` 로 감싼다(백엔드와 같은 마커). */
function snippet(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle)
  if (at === -1) return escapeText(text.slice(0, 80))

  const from = Math.max(0, at - 30)
  const head = from > 0 ? '…' : ''
  const tail = at + needle.length + 50 < text.length ? '…' : ''
  const before = text.slice(from, at)
  const hit = text.slice(at, at + needle.length)
  const after = text.slice(at + needle.length, at + needle.length + 50)
  return `${head}${escapeText(before)}**${escapeText(hit)}**${escapeText(after)}${tail}`
}

/** 문서 본문은 Y.Doc 에 있고 목이 읽을 수 없다. 처음 심어 둔 초안에서 글자만 뽑아 쓴다. */
function docText(id: string): string {
  return (DOC_SEEDS[id] ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function search(user: User, query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const hits: SearchHit[] = []

  for (const doc of DOCS) {
    // 휴지통에 든 문서는 검색되지 않는다. 백엔드도 `deleted_at` 이 없는 것만 본다.
    if (doc.deleted_at) continue
    const text = docText(doc.id)
    if (!doc.title.toLowerCase().includes(q) && !text.toLowerCase().includes(q)) continue
    hits.push({
      type: 'doc',
      id: doc.id,
      title: doc.title,
      sub: findFolder(doc.folder_id)?.title ?? '워크스페이스',
      snippet: snippet(text, q),
      to: `/docs/${doc.id}`,
      at: doc.updated_at,
    })
  }

  for (const post of POSTS) {
    // 권한 밖은 마스킹이 아니라 결과에서 뺀다. 검색은 존재 자체가 새면 안 된다.
    if (!canRead(user, post.min_role)) continue
    if (!post.title.toLowerCase().includes(q) && !post.body.toLowerCase().includes(q)) continue
    hits.push({
      type: 'post',
      id: post.id,
      title: post.title,
      sub: BOARD_DEFS.find((b) => b.id === post.board_id)?.name ?? post.board_id,
      snippet: snippet(post.body, q),
      to: `/board/${post.board_id}/${post.id}`,
      at: post.created_at,
    })
  }

  // 최근 것이 위로. 실제 서버는 일치도와 최근성을 더해 매기지만 목에는 일치도가 없다.
  return hits.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit)
}
