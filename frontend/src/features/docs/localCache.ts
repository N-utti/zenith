/**
 * 문서 본문의 브라우저 사본(y-indexeddb). 문서 하나에 저장소 하나이고, 로그아웃해도 남는다.
 * 사람이 바뀐 PC 에서 다음 사람이 개발자 도구로 앞사람이 연 문서를 읽거나, 앞사람이 오프라인에서
 * 쓰고 못 올린 편집이 다음 사람의 세션으로 서버에 올라가면 안 된다. 그래서 주인을 적어 두고, 다른
 * 사람으로 인증되는 순간(로그인·쿠키로 앱을 켤 때) 지운다.
 *
 * 로그아웃 때는 지우지 않는다. 오프라인 편집은 그 문서를 다시 열어야 서버로 올라가는데, 다른 화면에
 * 두고 온 문서의 못 올린 편집이 로그아웃 한 번에 경고 없이 사라진다. 대신 로그아웃 뒤 다음 사람이
 * 로그인하기 전까지는 사본이 남는다(직원은 어차피 서버에서 문서를 다 볼 수 있다).
 *
 * ponytail: 주인 값은 localStorage 라 개발자 도구로 고칠 수 있다. 일부러 고쳐 앞사람 편집을 다음 사람
 * 이름으로 올리는 것까지는 막지 못한다. 막으려면 서버가 주는 키로 사본을 암호화해야 한다.
 */
const PREFIX = 'zenith.doc.'
/** 저장소 주인(사용자 id). 저장소 이름과 겹치지 않게 접두어 밖에 둔다. */
const OWNER_KEY = 'zenith.docCacheOwner'

/**
 * 이번 세션에 사본을 써도 되는지. 지워야 하는데 못 지웠으면(목록을 못 읽는 브라우저, 오류) 앞사람
 * 사본이 남아 있을 수 있으니 편집기가 사본 없이 연다. 오프라인 편집은 안 되지만 새지는 않는다.
 */
let usable = true

export function docCacheName(docId: string): string {
  return PREFIX + docId
}

export function docCacheUsable(): boolean {
  return usable
}

/** 앱이 뜨기 전에 기다리는 일이라, 저장소가 고장 나 목록이 안 오면 여기서 끊고 못 지운 것으로 본다. */
const LIST_TIMEOUT_MS = 2000

/** 전부 지웠으면 true. 저장소 목록(`databases()`)이 없는 브라우저(Firefox 126 미만)는 false. */
async function clearDocCaches(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return true
  if (!indexedDB.databases) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('indexedDB.databases timeout')), LIST_TIMEOUT_MS)
  })
  // 목록이 제때 오면 타이머를 끈다. 안 끄면 2초 뒤 아무도 안 받는 거부가 콘솔에 남는다.
  const databases = await Promise.race([indexedDB.databases(), timeout]).finally(() =>
    clearTimeout(timer),
  )
  for (const { name } of databases) {
    // 열린 편집기의 연결은 lib0 가 삭제 신호를 받자마자 닫는다. 이 뒤에 여는 요청은 삭제 뒤로 줄 선다.
    if (name?.startsWith(PREFIX)) indexedDB.deleteDatabase(name)
  }
  return true
}

async function clearOrDisable(): Promise<boolean> {
  usable = await clearDocCaches().catch(() => false)
  return usable
}

/**
 * 인증된 사람이 주인과 다르면(주인을 모르면 포함) 지우고 주인을 바꾼다. 같은 사람이면(세션 만료 뒤
 * 다시 로그인) 남겨서, 못 올린 편집이 다시 연결될 때 올라가게 한다. 화면이 뜨기 전에 끝내야 한다.
 */
export async function claimDocCaches(userId: string): Promise<void> {
  let owner: string | null = null
  try {
    owner = localStorage.getItem(OWNER_KEY)
  } catch {
    // 주인을 못 읽으면 모르는 사람의 사본으로 보고 지운다.
  }
  if (owner === userId) return
  // 못 지웠으면 주인을 바꾸지 않는다. 다음 인증 때 다시 지운다.
  if (!(await clearOrDisable())) return
  try {
    localStorage.setItem(OWNER_KEY, userId)
  } catch {
    // 못 적으면 다음 인증에서 한 번 더 지워질 뿐이다.
  }
}

/** 로그인은 됐는데 누구인지 모를 때(`/me` 실패). 앞사람 사본일 수 있으니 지우고 주인도 비운다. */
export async function disownDocCaches(): Promise<void> {
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    // 위와 같다.
  }
  await clearOrDisable()
}
