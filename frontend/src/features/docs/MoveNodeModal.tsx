import { useMemo } from 'react'
import { CornerLeftUp, Folder } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { buildTree, canDrop, folderRows, type TreeItem } from './tree'
import type { DocTreeData } from './types'

const ROW =
  'flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm transition-colors'

/**
 * 문서·폴더를 옮길 폴더를 고른다. 사이드바의 끌어 놓기와 같은 일을 하고, 끌기를 못 쓰는
 * 키보드·손가락 기기의 길이기도 하다.
 *
 * 옮길 수 없는 자리(지금 있는 곳, 자기 자신과 자기 아래 폴더)는 지우지 않고 흐리게 남긴다.
 * 빼 버리면 트리 모양이 달라져 어디가 어디인지 다시 찾아야 한다.
 */
export function MoveNodeModal({
  item,
  title,
  data,
  onPick,
  onClose,
}: {
  item: TreeItem
  /** 옮기는 것의 이름. */
  title: string
  data: DocTreeData
  /** 고른 폴더의 id. null 은 최상위(폴더만). */
  onPick: (to: string | null) => void
  onClose: () => void
}) {
  const rows = useMemo(() => folderRows(buildTree(data)), [data])
  const here =
    item.kind === 'doc'
      ? data.docs.find((d) => d.id === item.id)?.folder_id
      : data.folders.find((f) => f.id === item.id)?.parent_id

  const row = (to: string | null, label: string, depth: number) => {
    const ok = canDrop(item, to, data)
    const Icon = to === null ? CornerLeftUp : Folder
    return (
      <li key={to ?? 'root'}>
        <button
          type="button"
          disabled={!ok}
          onClick={() => onPick(to)}
          className={cn(ROW, ok ? 'text-fg hover:bg-surface-hover cursor-pointer' : 'text-subtle')}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <Icon className="text-subtle size-4 shrink-0" />
          <span className="truncate">{label}</span>
          {here === to && <span className="text-subtle shrink-0 text-xs">지금 위치</span>}
        </button>
      </li>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="다른 폴더로 옮기기"
      description={`«${title}» 를 어디로 옮길까요?`}
      size="sm"
    >
      <ul>
        {/* 문서는 폴더 안에만 산다. 최상위는 폴더를 옮길 때만 보인다. */}
        {item.kind === 'folder' && row(null, '최상위', 0)}
        {rows.map(({ folder, depth }) => row(folder.id, folder.title, depth))}
      </ul>
    </Modal>
  )
}
