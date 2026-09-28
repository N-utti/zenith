/**
 * 문서 본문의 브라우저 사본(y-indexeddb). 문서 하나에 저장소 하나이고, 로그아웃해도 남는다.
 * 공용 PC 에서 다음 사람이 개발자 도구로 앞사람이 연 문서를 읽거나, 앞사람이 오프라인에서 쓰고
 * 못 올린 편집이 다음 사람의 세션으로 서버에 올라가면 안 된다. 그래서 주인을 적어 두고 사람이
 * 바뀌면 지운다.
 *
 * 지우면 서버에 못 올라간 오프라인 편집도 함께 사라진다. 로그아웃은 본인이 떠나는 것이고 오프라인이면
 * 로그아웃 요청 자체가 실패하므로 지운다. 로그인은 주인과 같은 사람이면(세션 만료 뒤 다시 로그인)
 * 남겨서, 다시 연결될 때 못 올린 편집이 올라가게 한다.
 */
const PREFIX = 'zenith.doc.'
/** 저장소 주인(사용자 id). 저장소 이름과 겹치지 않게 접두어 밖에 둔다. */
const OWNER_KEY = 'zenith.docCacheOwner'

export function docCacheName(docId: string): string {
  return PREFIX + docId
}

export async function clearDocCaches(): Promise<void> {
  // ponytail: 저장소 목록(`databases()`)이 없는 브라우저(Firefox 126 미만)는 무엇이 있는지 몰라 못 지운다.
  // 사내 PC 는 크롬·엣지·데스크톱 앱(WebView2)이라 두었다. 필요하면 연 문서 id 를 따로 적어 두고 지운다.
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) return
  for (const { name } of await indexedDB.databases()) {
    // 열린 편집기가 있으면 닫힐 때까지 기다렸다 지워진다. 그 뒤에 여는 요청은 삭제 뒤로 줄 선다.
    if (name?.startsWith(PREFIX)) indexedDB.deleteDatabase(name)
  }
}

/** 로그인한 사람이 주인과 다르면(주인을 모르면 포함) 지우고 주인을 바꾼다. */
export async function claimDocCaches(userId: string): Promise<void> {
  let owner: string | null = null
  try {
    owner = localStorage.getItem(OWNER_KEY)
  } catch {
    // 주인을 못 읽으면 모르는 사람의 사본으로 보고 지운다.
  }
  if (owner !== userId) {
    try {
      await clearDocCaches()
    } catch {
      // 지우다 실패했다고 로그인을 막지는 않는다. 주인을 바꾸지 않아 다음 로그인에서 다시 지운다.
      return
    }
  }
  try {
    localStorage.setItem(OWNER_KEY, userId)
  } catch {
    // 못 적으면 다음 로그인에서 한 번 더 지워질 뿐이다.
  }
}

/** 로그아웃. 주인을 비우고 지운다. 지우다 실패해도 다음 로그인이 주인을 몰라 다시 지운다. */
export function releaseDocCaches(): void {
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    // 위와 같다.
  }
  clearDocCaches().catch(() => undefined)
}
