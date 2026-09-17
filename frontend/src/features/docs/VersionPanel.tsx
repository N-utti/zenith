import { RotateCcw } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { hueOf } from '@/lib/avatar'
import { formatDay, formatRelative, formatTime } from '@/lib/datetime'
import { useVersions } from './api'
import type { DocVersion } from './types'

export function VersionPanel({
  docId,
  selectedId,
  onSelect,
}: {
  docId: string
  selectedId: string | null
  onSelect: (version: DocVersion | null) => void
}) {
  const { data, isPending, isError } = useVersions(docId)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {isPending && (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      )}
      {isError && (
        <p className="text-subtle px-3 py-8 text-center text-sm">버전을 불러오지 못했습니다.</p>
      )}

      {data && data.items.length === 0 && (
        <p className="text-subtle px-3 py-8 text-center text-sm">
          아직 저장된 버전이 없습니다.
          <br />
          편집하면 자동으로 쌓입니다.
        </p>
      )}

      {data?.items.map((version, index) => {
        const selected = version.id === selectedId
        return (
          <button
            key={version.id}
            type="button"
            onClick={() => onSelect(selected ? null : version)}
            className={cn(
              'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
              selected ? 'bg-accent-soft' : 'hover:bg-surface-hover',
            )}
          >
            <Avatar
              name={version.author?.name ?? '?'}
              hue={hueOf(version.author?.id ?? '')}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-fg flex items-center gap-1.5 text-sm">
                <span className="truncate">{formatRelative(version.created_at)}</span>
                {index === 0 && <Badge tone="accent">최신</Badge>}
                {version.label && <Badge tone="warning">{version.label}</Badge>}
              </p>
              <p className="text-subtle mt-0.5 truncate text-xs">
                {version.author?.name ?? '알 수 없음'} · {formatDay(version.created_at)}{' '}
                {formatTime(version.created_at)}
              </p>
            </div>
            {selected && <RotateCcw className="text-accent mt-0.5 size-3.5 shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
