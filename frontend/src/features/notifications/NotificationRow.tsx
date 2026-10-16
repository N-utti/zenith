import { Link } from 'react-router'
import { ClipboardCheck, FileText, Lock, Megaphone, MessagesSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { hueOf } from '@/lib/avatar'
import { formatRelative } from '@/lib/datetime'
import type { NotificationRowData } from './view'

const ICONS = {
  doc: FileText,
  chat: MessagesSquare,
  board: Megaphone,
  approval: ClipboardCheck,
  locked: Lock,
}

/** 알림 한 줄. 알림함(`/notifications`)과 헤더의 알림 드롭다운이 같이 쓴다. */
export function NotificationRow({
  row,
  onOpen,
  className,
}: {
  row: NotificationRowData
  onOpen: () => void
  /** 바깥 여백. 알림함은 오른쪽에 지우기 버튼 자리를 비운다. */
  className?: string
}) {
  const { notification, view } = row
  const Icon = ICONS[view.icon]
  const unread = notification.read_at === null

  const body = (
    <>
      {/* 색만으로 구분하지 않는다. 글자 굵기로도 갈리고, 낭독기에는 숨김 텍스트로 알린다. */}
      <span className="mt-2 size-2 shrink-0">
        {unread && (
          <>
            <span className="bg-accent block size-2 rounded-full" aria-hidden />
            <span className="sr-only">안 읽음</span>
          </>
        )}
      </span>

      {/* 가려진 알림에는 글쓴이를 남기지 않는다. 아바타 이니셜도 누군지 알려 주는 단서다. */}
      {view.masked ? (
        <span className="bg-sunken text-subtle grid size-7 shrink-0 place-items-center rounded-full">
          <Lock className="size-3.5" />
        </span>
      ) : (
        <Avatar name={view.actorName} hue={hueOf(view.actorId)} size="sm" />
      )}

      <div className="min-w-0 flex-1">
        <p className={'text-fg text-[13px] leading-relaxed' + (unread ? ' font-semibold' : '')}>
          {view.summary}
        </p>
        {view.detail && <p className="text-muted mt-1 truncate text-[12px]">{view.detail}</p>}
        <p className="text-subtle mt-1 flex items-center gap-1 text-[11px]">
          <Icon className="size-3" />
          {view.masked ? '열람 권한이 없습니다' : formatRelative(notification.created_at)}
        </p>
      </div>
    </>
  )

  const shared = cn('flex gap-3 text-left', className)

  // 권한 밖이라 제목이 가려진 알림은 열 수 없다. 누를 수 있게 두면 403 으로 보내는 셈이다.
  if (!view.to) return <div className={shared}>{body}</div>

  return (
    <Link
      to={view.to}
      onClick={onOpen}
      className={cn(shared, 'hover:bg-surface-hover transition-colors')}
    >
      {body}
    </Link>
  )
}
