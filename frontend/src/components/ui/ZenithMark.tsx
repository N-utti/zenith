import markDark from '@/assets/zenith-mark-white.png'
import markLight from '@/assets/zenith-mark.png'
import { cn } from '@/lib/cn'

/**
 * 제니스자산운용 심볼. 원본이 단색 실루엣이라 라이트·다크용 두 벌을 두고
 * `.dark` 클래스로 갈아 끼운다. 색을 CSS로 바꾸지 않는 이유는 브랜드 자산이라
 * 토큰 팔레트가 바뀌어도 따라 움직이면 안 되기 때문이다.
 *
 * 항상 로고 옆에 이름 텍스트가 함께 오므로 `alt`는 비운다(중복 낭독 방지).
 */
export function ZenithMark({ className }: { className?: string }) {
  return (
    <>
      <img src={markLight} alt="" aria-hidden className={cn('dark:hidden', className)} />
      <img src={markDark} alt="" aria-hidden className={cn('hidden dark:block', className)} />
    </>
  )
}
