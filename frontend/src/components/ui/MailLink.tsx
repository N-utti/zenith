import { Copy, Mail } from 'lucide-react'
import { useToast } from '@/components/ui/ToastContext'
import { copyText } from '@/lib/clipboard'

/**
 * 누르면 메일 쓰기가 열리는 주소와, 그 옆의 주소 복사 버튼.
 *
 * 팀은 네이버 메일을 웹에서 쓴다. 메일 링크는 PC 메일 앱을 여니, 받는 사람 칸에 붙여 넣을
 * 주소를 복사해 준다.
 */
export function MailLink({ email, icon = false }: { email: string; icon?: boolean }) {
  const toast = useToast()
  return (
    <span className="flex items-center gap-1">
      <a
        href={`mailto:${email}`}
        className="text-muted hover:text-accent flex items-center gap-1.5 break-all"
      >
        {icon && <Mail className="size-3.5 shrink-0" />}
        {email}
      </a>
      <button
        type="button"
        aria-label={`${email} 복사`}
        title="주소 복사"
        className="text-subtle hover:bg-surface-hover hover:text-fg -my-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors"
        onClick={() =>
          copyText(email)
            .then(() => toast.success('메일 주소를 복사했습니다.'))
            .catch(() => toast.error('복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.'))
        }
      >
        <Copy className="size-3.5" />
      </button>
    </span>
  )
}
