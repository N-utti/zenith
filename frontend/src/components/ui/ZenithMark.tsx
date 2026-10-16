import markDark from '@/assets/zenith-mark-white.svg'
import markLight from '@/assets/zenith-mark.svg'
import { cn } from '@/lib/cn'

/**
 * 제니스자산운용 심볼. 로고 원본에서 윤곽을 따 만든 SVG 한 벌이고, 색만 다른
 * 라이트(#142141)·다크(흰색) 두 파일을 `.dark` 클래스로 갈아 끼운다.
 * 색을 CSS로 바꾸지 않는 이유는 브랜드 자산이라 토큰 팔레트가 바뀌어도
 * 따라 움직이면 안 되기 때문이다.
 *
 * `alt`는 비운다. 쓰는 쪽이 이름을 준다(로그인은 옆 텍스트, 헤더는 링크의 aria-label).
 */
export function ZenithMark({ className }: { className?: string }) {
  return (
    <>
      <img src={markLight} alt="" aria-hidden className={cn('dark:hidden', className)} />
      <img src={markDark} alt="" aria-hidden className={cn('hidden dark:block', className)} />
    </>
  )
}
