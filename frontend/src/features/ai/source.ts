import { FileText, Globe, Megaphone, Paperclip } from 'lucide-react'
import type { Citation } from './types'

/** 근거 카드에 그리는 종류 표시. 아이콘은 통합검색 결과 줄과 맞춘다. */
export const SOURCE_KINDS = {
  doc: { icon: FileText, label: '문서' },
  post: { icon: Megaphone, label: '게시글' },
  file: { icon: Paperclip, label: '첨부 파일' },
  web: { icon: Globe, label: '웹' },
}

/** 모르는 종류가 와도 카드는 그려져야 한다. 문서로 본다. */
export function sourceKind(source: Citation) {
  const type = source.type ?? 'doc'
  // `constructor` 같은 값이 객체의 기본 속성을 집지 않게 자기 키만 본다.
  return Object.hasOwn(SOURCE_KINDS, type) ? SOURCE_KINDS[type] : SOURCE_KINDS.doc
}

/**
 * 카드를 눌렀을 때 갈 자리. 서버가 준 `to` 가 앱 안 경로일 때만 따르고, 아니면 문서로 간다.
 * `//host` 나 `https:` 로 시작하는 값은 Link 가 바깥 주소로 그리므로 받지 않는다. 브라우저는
 * 역슬래시를 슬래시로 읽고 탭·줄바꿈을 지운 뒤 해석하므로(`/\host`, `/<탭>/host`) 그 글자가
 * 든 값도 받지 않는다.
 * 갈 곳을 알 수 없으면 null 이고, 카드는 링크가 아닌 채로 그려진다.
 */
export function sourceTo(source: Citation): string | null {
  const { to, doc_id } = source
  if (source.type === 'web') return null
  if (to && to.startsWith('/') && !to.startsWith('//') && !/[\\\s]/.test(to)) return to
  return doc_id ? `/docs/${doc_id}` : null
}

/**
 * 웹 출처(백엔드 #388 팩트체커 웹 검색)의 바깥 주소. 앱 안 라우터로 보내지 않고 새 창으로 연다.
 * 서버가 검색 결과 주소만 걸러 주지만 여기서도 http·https 이고 사용자 정보(`사내주소@다른곳`)가 없는 것만 받는다.
 * 카드에는 서버가 준 글이 아니라 이 주소에서 뽑은 호스트를 보여 준다. 글과 실제 갈 곳이 어긋나지 않게.
 */
export function webLink(source: Citation): { href: string; host: string } | null {
  if (source.type !== 'web' || !source.to) return null
  let url: URL
  try {
    url = new URL(source.to)
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
  return { href: url.href, host: url.host }
}
