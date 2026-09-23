import { useId, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Textarea } from '@/components/ui/Textarea'
import { hueOf } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import { useColleagues } from './colleagues'
import { insertMention, mentionQueryAt } from './mentions'

const MAX_OPTIONS = 6

/**
 * `@` 를 치면 사람 목록이 뜨는 입력칸. 고르면 본문에 `@이름 ` 을 넣는다.
 *
 * 서버는 본문의 `@이름` 글자로 멘션을 판정한다(id 를 싣지 않는다). 그래서 고른 결과도 글자뿐이고,
 * 손으로 친 `@이름` 과 똑같이 취급된다. 문서 댓글과 채팅 입력창이 같은 모양을 쓴다.
 *
 * `people` 을 주면 그 후보만 뜬다(채팅은 채널 멤버로 좁힌다). 안 주면 전체 동료 목록이다.
 */
export function MentionTextarea({
  value,
  onValueChange,
  inputRef,
  onKeyDown,
  people: peopleProp,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
  people?: { id: string; name: string }[]
}) {
  const { people: colleagues } = useColleagues()
  const people = peopleProp ?? colleagues
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? ownRef
  const listId = useId()

  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  // Esc 로 닫은 `@` 의 자리. 같은 토큰을 계속 치는 동안은 다시 뜨지 않는다.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  // 보내고 입력칸이 비면 잊는다. 안 그러면 다음 댓글 맨 앞의 @ 에서 목록이 영영 안 뜬다.
  if (!value && dismissedAt !== null) setDismissedAt(null)

  /** 커서가 움직였다. 닫아 둔 토큰을 벗어났으면(다른 @ 이거나 토큰 밖) 잊는다. */
  const moveCaret = (text: string, at: number) => {
    setCaret(at)
    // 함수형으로 쓴다. React 의 onSelect 는 Esc 의 keydown 과 같은 이벤트에서 돌기도 해서, 닫힌
    // 값을 들고 있으면 방금 Esc 로 닫은 것을 바로 되연다.
    const start = mentionQueryAt(text, at)?.start
    setDismissedAt((prev) => (start === prev ? prev : null))
  }

  const token = focused ? mentionQueryAt(value, caret) : null
  const options =
    token && token.start !== dismissedAt
      ? people.filter((person) => person.name.includes(token.query)).slice(0, MAX_OPTIONS)
      : []
  const open = options.length > 0
  const activeIndex = Math.min(active, options.length - 1)

  const pick = (name: string) => {
    if (!token) return
    const next = insertMention(value, caret, token.start, name)
    onValueChange(next.text)
    setCaret(next.caret)
    // 값이 그려진 뒤에 커서를 옮겨야 한다. 먼저 옮기면 React 가 값을 넣으며 끝으로 보낸다.
    requestAnimationFrame(() => ref.current?.setSelectionRange(next.caret, next.caret))
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        {...props}
        ref={ref}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value)
          moveCaret(e.target.value, e.target.selectionStart)
          setActive(0)
        }}
        // 방향키·클릭으로 커서만 옮겨도 질의가 바뀐다.
        onSelect={(e) => moveCaret(e.currentTarget.value, e.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // 한글 조합 중 Enter 는 글자를 확정하는 키다. 목록에서 고르는 데 쓰지 않는다.
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((activeIndex + step + options.length) % options.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pick(options[activeIndex].name)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDismissedAt(token?.start ?? null)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {/* 입력칸 위로 띄운다. 댓글·채팅 입력칸은 화면 아래에 붙어 있다. */}
      <ul
        id={listId}
        role="listbox"
        aria-label="부를 사람"
        hidden={!open}
        className="border-line bg-surface absolute inset-x-0 bottom-full z-30 mb-1 rounded-xl border p-1 shadow-lg"
      >
        {options.map((person, i) => (
          <li
            key={person.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => setActive(i)}
            // 누르는 순간 입력칸이 포커스를 잃으면 목록이 닫혀 클릭이 닿지 않는다.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(person.name)}
            className={cn(
              'text-fg flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
              i === activeIndex && 'bg-surface-hover',
            )}
          >
            <Avatar name={person.name} hue={hueOf(person.id)} size="sm" />
            {person.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
