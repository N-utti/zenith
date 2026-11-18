import { useId } from 'react'
import { Checkbox } from '@/components/ui/Checkbox'
import { Spinner } from '@/components/ui/Spinner'
import { PersonChips } from '@/features/people/PersonChip'
import { useColleagues } from '@/features/people/colleagues'

export interface PrivateFolderChoice {
  /** 나만 보기. 켜면 개인 폴더로 만든다(백엔드 README 72). */
  on: boolean
  /** 그래도 같이 볼 사람들(백엔드 README 74). 비어 있으면 정말 나만 본다. */
  picked: string[]
}

/**
 * 새 폴더 창의 「나만 보기」와 같이 볼 사람. 최상위 폴더를 만들 때만 보인다. 개인 폴더는 최상위에만
 * 만들 수 있고, 그 아래 폴더는 따로 고르지 않아도 따라간다.
 */
export function PrivateFolderOption({
  value,
  onChange,
}: {
  value: PrivateFolderChoice
  onChange: (next: PrivateFolderChoice) => void
}) {
  const peopleLabel = useId()
  const { people, isPending, isError } = useColleagues()

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Checkbox
        checked={value.on}
        onChange={(e) => onChange({ ...value, on: e.target.checked })}
        label="나만 보기"
        description="나와 아래에서 선택한 사람만 봅니다. 임원도 선택하지 않으면 볼 수 없습니다."
      />
      {value.on && (
        <div role="group" aria-labelledby={peopleLabel}>
          <p id={peopleLabel} className="text-fg mb-2 text-sm font-medium">
            같이 볼 사람 (선택)
          </p>
          {isPending ? (
            <Spinner />
          ) : isError ? (
            <p className="text-danger text-xs">사람 목록을 불러오지 못했습니다.</p>
          ) : (
            <PersonChips
              people={people}
              picked={value.picked}
              onToggle={(id) =>
                onChange({
                  ...value,
                  picked: value.picked.includes(id)
                    ? value.picked.filter((each) => each !== id)
                    : [...value.picked, id],
                })
              }
            />
          )}
          <p className="text-subtle mt-2 text-xs leading-relaxed">
            선택한 사람은 안의 문서를 보고 수정할 수 있습니다. 폴더 이름과 볼 사람은 나만 바꿉니다.
            나중에 폴더 메뉴의 「볼 사람」에서 바꿀 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}
