import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router'
import { MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useTodayArrangementKinds } from '@/features/attendance/api'
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/types'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { useChannels, useCreateChannel } from './api'

type Person = { id: string; name: string }

/** 아바타 위를 스쳐 지나가는 것으로는 뜨지 않게 잠깐 머문 뒤에 띄운다. */
const OPEN_MS = 300
/** 아바타에서 카드로 마우스를 옮기는 사이 닫히지 않게 잠깐 기다린다. */
const CLOSE_MS = 150
/** 화면 끝에서 띄울 틈. */
const EDGE = 8

/** 지금 떠 있는 카드를 닫는 함수. 카드는 화면에 하나만 둔다. */
let closeOpenCard: (() => void) | null = null

/**
 * 메시지 줄의 아바타. 마우스를 올리면 그 사람의 프로필 카드가 아바타 아래에 뜬다.
 * 호버가 없는 손가락 기기와 키보드는 누르면 뜬다.
 *
 * 우클릭 메뉴(`ContextMenu`)를 쓰지 않는다. 그쪽은 열리면 초점을 가져가서, 입력창에 쓰다가
 * 마우스만 지나가도 초점을 뺏긴다. 카드 안의 조회(채널 목록·오늘 근무)는 열 때만 붙는다.
 * 줄마다 붙이면 줄을 건너뛰는 `memo` 가 소용없어진다(`MessageRow`).
 */
export function ProfileAvatar({ person }: { person: Person }) {
  const [open, setOpen] = useState<{ anchor: DOMRect; keyboard: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const timer = useRef<number>(undefined)
  const close = useCallback(() => setOpen(null), [])

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  const show = (keyboard = false) => {
    window.clearTimeout(timer.current)
    if (!button.current) return
    // 카드는 하나만. 눌러서 연 카드는 마우스가 떠나도 안 닫혀서, 다른 아바타에 올리면 둘이 겹친다.
    if (closeOpenCard !== close) closeOpenCard?.()
    closeOpenCard = close
    setOpen({ anchor: button.current.getBoundingClientRect(), keyboard })
  }
  const keep = () => window.clearTimeout(timer.current)
  const hide = () => later(close, CLOSE_MS)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (closeOpenCard === close) closeOpenCard = null
    },
    [close],
  )

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`${person.name} 프로필`}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        onPointerEnter={(e) => e.pointerType === 'mouse' && later(show, OPEN_MS)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
        // 마우스는 이미 떠 있다. 누르는 것은 손가락과 키보드(Enter, 이때 `detail` 이 0)의 길이다.
        // 손가락·키보드로 다시 누르면 닫는다. 마우스로 누른 것은 이미 떠 있는 카드를 그대로 둔다.
        onClick={(e) =>
          open && (e.nativeEvent as PointerEvent).pointerType !== 'mouse'
            ? close()
            : show(e.detail === 0)
        }
        className="shrink-0 cursor-pointer self-start rounded-full"
      >
        <Avatar name={person.name} hue={hueOf(person.id)} size="md" />
      </button>
      {open && (
        <ProfileCard
          person={person}
          anchor={open.anchor}
          autoFocus={open.keyboard}
          opener={button}
          onEnter={keep}
          onLeave={hide}
          onClose={close}
        />
      )}
    </>
  )
}

function ProfileCard({
  person,
  anchor,
  autoFocus,
  opener,
  onEnter,
  onLeave,
  onClose,
}: {
  person: Person
  anchor: DOMRect
  /** 키보드로 열었으면 카드의 버튼으로 초점을 옮긴다. 본문 끝에 붙어 Tab 으로는 닿지 않는다. */
  autoFocus: boolean
  opener: RefObject<HTMLButtonElement | null>
  onEnter: () => void
  onLeave: () => void
  onClose: () => void
}) {
  const me = useCurrentUser()
  const { channelId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateChannel()
  const { data: channels } = useChannels()
  const kind = useTodayArrangementKinds().get(person.id)
  const ref = useRef<HTMLDivElement>(null)
  const mine = person.id === me.id
  // 이미 있는 DM 이면 서버에 묻지 않고 그리로 간다. 지금 그 DM 안이면 보낼 곳이 여기라 버튼을 뺀다.
  const dm = channels?.items.find(
    (channel) => channel.is_dm && channel.members.some((member) => member.id === person.id),
  )

  // 아바타 아래에 둔다. 화면 아래가 모자라면(마지막 메시지) 위로 뒤집는다. 그린 뒤에야 높이를 안다.
  // 뒤집으면 아랫변을 붙인다. 채널 목록이 늦게 와 버튼이 빠져도 카드가 아바타에서 뜨지 않는다.
  // 초점은 자리를 잡은 뒤에 옮긴다. 먼저 옮기면 브라우저가 그 자리로 굴려 카드가 스크롤에 닫힌다.
  useLayoutEffect(() => {
    const card = ref.current
    if (!card) return
    if (anchor.bottom + 4 + card.offsetHeight + EDGE > window.innerHeight) {
      card.style.bottom = `${window.innerHeight - anchor.top + 4}px`
    } else {
      card.style.top = `${anchor.bottom + 4}px`
    }
    card.style.left = `${Math.max(EDGE, Math.min(anchor.left, window.innerWidth - card.offsetWidth - EDGE))}px`
    if (autoFocus) card.querySelector('button')?.focus({ preventScroll: true })
  }, [anchor, autoFocus])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !opener.current?.contains(target)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ref.current?.contains(document.activeElement)) opener.current?.focus()
      onClose()
    }
    // 잡아 둔 자리는 목록이 구르면 아바타에서 떨어진다. 따라다니게 하는 것보다 닫는 쪽이 싸다.
    // ponytail: 위를 읽는 중에도 다른 영역이 구르면 닫힌다. 거슬리면 `ContextMenu` 처럼 아바타를 품은 영역만 본다.
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [onClose, opener])

  const openDm = () => {
    onClose()
    if (dm) return void navigate(`/chat/${dm.id}`)
    // 약속으로 받는다. 카드가 먼저 닫혀 이 훅도 사라지는데, `mutate` 의 콜백은 그 뒤로 불리지 않는다.
    create.mutateAsync({ dm_user_id: person.id }).then(
      (channel) => void navigate(`/chat/${channel.id}`),
      // 비활성 계정은 422 다(`NewChatModal`).
      (err: unknown) =>
        toast.error(
          err instanceof ApiError && err.status === 422
            ? '지금은 이 사람과 대화를 시작할 수 없습니다. 비활성 계정일 수 있습니다.'
            : '대화를 열지 못했습니다.',
        ),
    )
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${person.name} 프로필`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onEnter()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onLeave()}
      // 카드는 본문 끝에 붙어 Tab 순서가 아바타와 떨어져 있다. Tab 은 아바타로 되돌리고 닫는다.
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        e.preventDefault()
        opener.current?.focus()
        onClose()
      }}
      // 초점이 카드 밖으로 나가면 닫는다(다른 곳을 눌렀거나 창을 떠남).
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget)) onClose()
      }}
      className="border-line bg-surface fixed z-50 w-60 max-w-[calc(100vw-1rem)] rounded-xl border p-1.5 shadow-lg"
    >
      <div className="flex items-center gap-3 px-2 py-2">
        <Avatar name={person.name} hue={hueOf(person.id)} size="lg" />
        <div className="min-w-0">
          <p className="text-fg truncate text-sm font-semibold">
            {person.name}
            {mine && <span className="text-subtle ml-1 text-xs font-normal">(나)</span>}
          </p>
          {/* 서버가 남의 팀·이메일을 주지 않는다(`/people` 은 이름뿐). 근태가 아는 오늘 근무만 붙인다. */}
          {kind && (
            <span className="text-info bg-info/12 mt-1 inline-block rounded-full px-2 py-px text-xs leading-4 font-medium">
              {ATTENDANCE_STATUS_LABEL[kind]}
            </span>
          )}
        </div>
      </div>
      {!mine && dm?.id !== channelId && (
        <>
          <div className="border-line my-1 border-t" />
          <button
            type="button"
            onClick={openDm}
            className="text-fg hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
          >
            <MessageCircle className="size-4 shrink-0 opacity-70" />
            메시지 보내기
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
