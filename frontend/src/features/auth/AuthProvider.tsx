import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { resetThread } from '@/features/ai/store'
import { clearDrafts } from '@/features/chat/drafts'
import { claimDocCaches, clearDocCaches, releaseDocCaches } from '@/features/docs/localCache'
import { api, ApiError } from '@/lib/api'
import type { User } from '@/types'
import { AuthContext, type AuthValue } from './AuthContext'
import { meQueryKey } from './queries'

/** 세션은 HttpOnly 쿠키라 JS 가 "로그인했는지" 미리 알 수 없다. 서버에 묻고, 401 이면 익명이다(11 §10.2). */
async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>('/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/**
 * 앞사람이 이 탭에 남긴 것을 버린다: 서버에서 받아 둔 쿼리 캐시(프로필 제외), AI 대화, 쓰다 만 채팅 글.
 * 결재 본문·가려지기 전 게시글 제목·AI 근거 인용문처럼 등급마다 다른 내용이 섞여 있다.
 */
function forgetPreviousUser(qc: QueryClient) {
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
  resetThread()
  clearDrafts()
}

/**
 * 같은 브라우저의 다른 탭에 "이 브라우저의 사용자가 바뀌었다" 고 알린다. 쿠키는 탭끼리 공유하므로 다른
 * 탭에서 로그인하면 이 탭의 요청도 그 사람으로 나간다. 401 이 안 오니 이 탭은 사람이 바뀐 걸 모르고
 * 앞사람 이름·AI 대화·캐시를 계속 보여 준다. 받은 탭은 첫 화면으로 다시 열어 모듈 상태까지 한 번에
 * 버린다. 앞사람이 보던 주소(결재·방 id, 검색어)도 남기지 않으려고 새로고침이 아니라 `/` 로 간다.
 * 보낸 탭 자신은 받지 않는다(BroadcastChannel 규약). 없는 환경(구형 브라우저)이면 알리지 않는다.
 */
const tabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('zenith.auth')

/** 로그아웃은 `null`, 로그인은 했는데 누구인지 못 받았으면 `''`(어느 탭과도 달라 전부 다시 연다). */
type TabMessage = { userId: string | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    // 401 은 fetchMe 가 null 로 바꾸므로 여기 오는 오류는 서버 응답이 아닌 것(네트워크 등)뿐이다.
    // 부팅 때 한 번 삐끗했다고 로그인 화면으로 보내지 않는다.
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!tabs) return
    const current = data?.id ?? null
    const onMessage = (e: MessageEvent<TabMessage>) => {
      // 같은 사람이 다른 탭에서 다시 로그인한 것이면 이 탭의 대화·쓰던 글을 날릴 이유가 없다.
      // 첫 `/me` 가 도는 중이면 `current` 가 아직 null 이라 누가 로그인했든 다시 연다. 그 요청은
      // 바뀌기 전 쿠키로 나갔을 수 있다. 다시 연 탭은 알리지 않으므로 되풀이되지 않는다.
      if (e.data?.userId !== current) location.replace('/')
    }
    tabs.addEventListener('message', onMessage)
    return () => tabs.removeEventListener('message', onMessage)
  }, [data])

  const login = useCallback(
    async (email: string, password: string) => {
      // 04 §1: 204 + Set-Cookie. 본문에 토큰이 없으므로 프로필은 서버에 다시 묻는다.
      await api<void>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      // 세션 만료(`queryClient`)로 온 로그인 화면은 프로필만 비웠을 뿐 앞사람 캐시를 그대로 들고 있다.
      // 그래서 로그아웃과 별개로 들어오는 쪽에서도 비운다. 로그인 화면에는 구독 중인 화면이 없어 안전하다.
      forgetPreviousUser(qc)
      let me: User | undefined
      try {
        me = await api<User>('/me')
        // 문서 사본은 주인이 바뀌었을 때만 지운다. 프로필을 넣으면 곧바로 화면이 뜨고 문서를 열 수 있으니
        // 그 전에 끝낸다.
        await claimDocCaches(me.id)
        qc.setQueryData(meQueryKey, me)
      } catch (error) {
        // `/me` 가 실패해 누구인지 모르면 주인과 비교할 수 없다. 앞사람 사본일 수 있으니 지운다.
        await clearDocCaches().catch(() => undefined)
        throw error
      } finally {
        // 여기 왔으면 쿠키는 이미 바뀌었다. `/me` 가 실패해도 다른 탭은 알아야 한다.
        tabs?.postMessage({ userId: me?.id ?? '' } satisfies TabMessage)
      }
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' })
    } catch (error) {
      // 세션이 이미 죽었어도 로컬 정리는 끝까지 진행한다.
      if (!(error instanceof ApiError)) throw error
    }
    // 프로필을 먼저 null 로 바꿔야 구독 중인 화면이 익명으로 전이해 로그인 화면으로 간다.
    // qc.clear() 로 쿼리를 통째로 지우면 구독자는 옛 쿼리를 붙든 채 다시 그려지지 않는다.
    qc.setQueryData(meQueryKey, null)
    // AI 대화를 비우면 받고 있던 답변 스트림도 다음 조각에서 닫힌다(`useAsk`).
    forgetPreviousUser(qc)
    releaseDocCaches()
    // 로그아웃한 사람의 다른 탭도 로그인 화면으로 보낸다. 자리를 뜬 뒤 그 탭에 앞사람 화면이 남지 않게.
    tabs?.postMessage({ userId: null } satisfies TabMessage)
  }, [qc])

  const value = useMemo<AuthValue>(() => {
    const status: AuthValue['status'] = isPending
      ? 'loading'
      : isError || !data
        ? 'anonymous'
        : 'authenticated'

    return { user: status === 'authenticated' ? (data ?? null) : null, status, login, logout }
  }, [data, isPending, isError, login, logout])

  return <AuthContext value={value}>{children}</AuthContext>
}
