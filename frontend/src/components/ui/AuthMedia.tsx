import { useState, type ComponentProps, type MouseEvent } from 'react'
import { useToast } from '@/components/ui/ToastContext'
import { api, ApiError } from '@/lib/api'
import { downloadFromApi } from '@/lib/download'
import { httpUrl } from '@/lib/serverOrigin'

/*
 * 쿠키로 인증되는 서버 파일(`/api/...`)을 그리고 내려받는 자리.
 *
 * 쿠키는 남아 있어도 access 는 15분이면 죽는다(04 §1). `api()` 는 만료면 갱신하고 다시 보내지만,
 * `<img>`·링크 이동은 브라우저가 직접 요청해 그 길을 안 탄다. 채팅은 소켓으로만 오가서 REST 가
 * 한동안 없으면 그림이 401 로 깨지고 내려받기가 「권한 없음」이 된다(#446).
 */

/** 동시에 깨진 그림들(오래 비운 채널을 열 때)이 `/me` 한 번을 같이 기다린다. */
let probing: Promise<unknown> | null = null

/**
 * 못 그리면 한 번 갱신하고 다시 받는다. 그래도 안 되면 `onError` 로 넘긴다.
 * `/me` 는 만료일 때만 refresh 를 부른다(지워진 파일의 404 로 refresh 토큰을 돌리지 않는다).
 * 같은 주소를 다시 넣으면 브라우저가 안 받으니 뒤에 쿼리를 붙인다. 서버는 무시한다.
 */
export function AuthImg({ path, onError, ...rest }: ComponentProps<'img'> & { path: string }) {
  // 주소별로 기억한다. 문서 사진 블록은 남의 편집으로 `src` 가 바뀌어도 같은 컴포넌트를 쓴다.
  const [retriedPath, setRetriedPath] = useState<string | null>(null)
  const retried = retriedPath === path
  const src = httpUrl(path)
  return (
    <img
      {...rest}
      src={retried ? `${src}${src.includes('?') ? '&' : '?'}r=1` : src}
      onError={(event) => {
        if (retried) return onError?.(event)
        probing ??= api('/me')
          .catch(() => {})
          .finally(() => {
            probing = null
          })
        void probing.then(() => setRetriedPath(path))
      }}
    />
  )
}

/**
 * 누르면 앱이 받아 저장시키는 링크(이유는 `downloadFromApi`). `href` 는 우클릭 메뉴용으로 둔다.
 * Ctrl 클릭도 내려받는다. 새 탭으로 보내면 만료된 채 401 을 본다.
 * ponytail: 받는 중 다시 누르면 두 번 받는다(종전 링크와 같다). 큰 파일에서 문제 되면 busy 를 둔다.
 */
export function DownloadLink({
  path,
  name,
  ...rest
}: Omit<ComponentProps<'a'>, 'href' | 'download' | 'onClick'> & { path: string; name: string }) {
  const toast = useToast()
  const download = async (event: MouseEvent) => {
    event.preventDefault()
    try {
      await downloadFromApi(path, name || '파일')
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : '파일을 내려받지 못했습니다.')
    }
  }
  return <a {...rest} href={httpUrl(path)} download={name} onClick={download} />
}
