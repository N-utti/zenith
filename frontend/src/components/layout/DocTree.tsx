import { useMemo, useState, type DragEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { RetryButton } from '@/components/ui/Card'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import {
  useCreateDoc,
  useCreateFolder,
  useMoveNode,
  useRenameFolder,
  useTree,
} from '@/features/docs/api'
import {
  ancestorsOf,
  buildTree,
  canDrop,
  previewDocs,
  type DragItem,
  type TreeNode,
} from '@/features/docs/tree'

/** 폴더를 펼쳤을 때 사이드바에 보일 문서 수. 넘치면 나머지는 폴더 목록 화면에서 본다. */
const PREVIEW_DOCS = 5

// 값의 의미가 문서 id 에서 폴더 id 로 바뀌었다. 옛 키를 그대로 쓰면 안 맞는 id 가 영원히 쌓인다.
const EXPANDED_KEY = 'zenith.docTreeExpanded.v2'

/**
 * 사용자가 직접 펼친 폴더 id. AppLayout 이 bleed 유무로 두 벌이라 에디터를 열고 닫을 때마다
 * 트리가 다시 마운트되고, 컴포넌트 상태만으로는 그때마다 접혀 버린다(12 §10). 사이드바 접힘과
 * 같은 방식으로 브라우저에 남긴다.
 */
const expandedIds = readExpanded()

function readExpanded(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function rememberExpanded(id: string, expanded: boolean) {
  if (expanded) expandedIds.add(id)
  else expandedIds.delete(id)
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedIds]))
  } catch {
    // 저장 못 해도 이번 마운트의 펼침은 유지된다.
  }
}

/** 끌어 놓을 자리(`data-drop`) 중 최상위를 가리키는 값. 폴더는 자기 id 를 쓴다. */
const ROOT_DROP = ''

/**
 * 끄는 동안 포인터에 붙는 그림을 바꾼다. 브라우저 기본값(주소가 든 말풍선)은 위쪽 메뉴 링크를 끌
 * 때와 똑같아서 옮기는 중인지 알 수 없다. 그 줄의 아이콘과 이름을 본뜬 카드를 붙인다.
 *
 * 그림은 dragstart 가 끝난 직후에 찍힌다. 화면 밖에 잠깐 붙였다가 다음 박자에 치운다.
 */
function setDragCard(e: DragEvent, row: HTMLElement) {
  const card = row.cloneNode(true) as HTMLElement
  card.className =
    'bg-surface text-fg border-accent fixed -top-96 left-0 flex max-w-60 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13.5px] font-medium'
  document.body.append(card)
  e.dataTransfer.setDragImage(card, 12, 16)
  setTimeout(() => card.remove())
}

interface RowActions {
  /** 끌고 있는 문서·폴더의 id. 제자리의 줄은 흐려진다. */
  dragId: string | null
  /** 끌고 있는 것이 지금 올라가 있는 놓을 자리. 그 폴더가 스스로를 강조한다. */
  over: string | null
  onNavigate?: () => void
  onAddDoc: (folderId: string) => void
  onAddFolder: (parentId: string | null) => void
  onRename: (folderId: string, title: string) => void
}

function DocRow({
  node,
  depth,
  dragging,
  onNavigate,
}: {
  node: TreeNode & { kind: 'doc' }
  depth: number
  dragging: boolean
  onNavigate?: () => void
}) {
  return (
    <div className={cn('flex items-center transition-opacity', dragging && 'opacity-40')}>
      <span className="size-5 shrink-0" style={{ marginLeft: depth * 14 }} />
      <NavLink
        to={`/docs/${node.doc.id}`}
        onClick={onNavigate}
        data-drag="doc"
        data-id={node.doc.id}
        className={({ isActive }) =>
          cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
            isActive
              ? 'bg-accent-soft text-accent font-semibold'
              : 'text-muted hover:bg-surface-hover hover:text-fg',
          )
        }
      >
        <FileText className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="truncate">{node.doc.title}</span>
      </NavLink>
    </div>
  )
}

function FolderAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      // 터치에서는 셋이 붙어 있어 손가락으로 잘못 누르기 쉽다. 높이는 대략 행만큼 키우고, 폭은
      // 깊은 폴더의 이름 칸을 덜 먹도록 조금만 늘린다.
      className="text-subtle hover:text-fg grid size-6 cursor-pointer place-items-center rounded transition-colors pointer-coarse:h-8 pointer-coarse:w-7"
    >
      {children}
    </button>
  )
}

function FolderRow({
  node,
  depth,
  openPath,
  actions,
}: {
  node: TreeNode & { kind: 'folder' }
  depth: number
  /** 처음 마운트할 때 펼쳐 둘 폴더 id들. 열려 있는 문서까지의 경로다. */
  openPath: Set<string>
  actions: RowActions
}) {
  const { id, title } = node.folder
  const { docId } = useParams()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const current = pathname === '/docs' && searchParams.get('folder') === id
  const [opened, setOpened] = useState(() => expandedIds.has(id))
  /*
   * 열려 있는 문서까지의 경로는 기억과 무관하게 항상 펼친다. 접어 둔 폴더 안의 문서를 ⌘K 로
   * 열어도 보여야 한다. 이 판정을 `useState` 초기값으로만 하면 안 된다. 편집 화면에서 다른
   * 문서로 옮길 때는 트리가 다시 마운트되지 않아 `openPath` 만 바뀌고 펼쳐지지 않는다.
   */
  const expanded = opened || openPath.has(id)

  const toggle = () => {
    const next = !expanded
    setOpened(next)
    rememberExpanded(id, next)
  }

  const Icon = expanded ? FolderOpen : Folder

  const docs = node.children.flatMap((child) => (child.kind === 'doc' ? [child.doc] : []))
  const shownDocs = previewDocs(docs, PREVIEW_DOCS, docId)

  return (
    // 줄과 그 아래 펼친 내용이 통째로 이 폴더의 놓을 자리다. 안쪽 폴더가 먼저 잡는다.
    <div
      data-drop={id}
      className={cn(
        'rounded-md transition-[background-color,opacity]',
        actions.over === id && 'bg-accent-soft',
        // 폴더는 안에 든 것까지 같이 옮겨지므로 펼친 내용까지 흐린다.
        actions.dragId === id && 'opacity-40',
      )}
    >
      <div className="group/row flex items-center">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${title} ${expanded ? '접기' : '펼치기'}`}
          aria-expanded={expanded}
          // 폴더 이름이 이동 링크가 되어 펼치기는 이 화살표만 한다. 모바일에서 눌리게 보이는 크기보다
          // 넓게 받는다(before 로 사방 4px, 28px).
          className="text-subtle hover:text-fg relative grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors before:absolute before:-inset-1"
          style={{ marginLeft: depth * 14 }}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>

        {/* 이름은 폴더 목록 화면으로 간다(노션과 같이). 펼치고 접기는 옆 화살표가 맡는다. */}
        <Link
          to={`/docs?folder=${id}`}
          onClick={(e) => {
            // 새 탭으로 여는 클릭이면 이 화면은 그대로 둔다.
            if (e.metaKey || e.ctrlKey || e.shiftKey) return
            if (!expanded) toggle()
            actions.onNavigate?.()
          }}
          aria-current={current ? 'page' : undefined}
          data-drag="folder"
          data-id={id}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] font-medium transition-colors',
            current
              ? 'bg-accent-soft text-accent font-semibold'
              : 'text-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Icon className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{title}</span>
        </Link>

        {/*
          폴더 행에만 붙는 조작. 마우스를 올렸을 때와 키보드 초점이 왔을 때 보인다.
          `opacity-0` 은 보이지만 않을 뿐 초점을 받으므로 Tab 으로도 닿는다.
          터치 기기에는 hover 가 없어 늘 보인다. 안 그러면 모바일에서 폴더를 골라 문서를 만들 길이
          없고, 투명한 버튼이 행 오른쪽 탭을 가로채 모르는 새 문서가 생긴다.
        */}
        <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
          <FolderAction label={`${title} 안에 새 문서`} onClick={() => actions.onAddDoc(id)}>
            <FilePlus2 className="size-3.5" />
          </FolderAction>
          <FolderAction label={`${title} 안에 새 폴더`} onClick={() => actions.onAddFolder(id)}>
            <FolderPlus className="size-3.5" />
          </FolderAction>
          <FolderAction label={`${title} 이름 변경`} onClick={() => actions.onRename(id, title)}>
            <Pencil className="size-3.5" />
          </FolderAction>
        </div>
      </div>

      {expanded && (
        <>
          {node.children.map(
            (child) =>
              child.kind === 'folder' && (
                <FolderRow
                  key={child.folder.id}
                  node={child}
                  depth={depth + 1}
                  openPath={openPath}
                  actions={actions}
                />
              ),
          )}
          {shownDocs.map((doc) => (
            <DocRow
              key={doc.id}
              node={{ kind: 'doc', doc }}
              depth={depth + 1}
              dragging={actions.dragId === doc.id}
              onNavigate={actions.onNavigate}
            />
          ))}
          {shownDocs.length < docs.length && (
            <div className="flex items-center">
              <span className="size-5 shrink-0" style={{ marginLeft: (depth + 1) * 14 }} />
              <Link
                to={`/docs?folder=${id}`}
                onClick={actions.onNavigate}
                aria-label={`${title} 전체 ${docs.length}개 보기`}
                className="text-subtle hover:bg-surface-hover hover:text-fg flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 text-[13px] transition-colors"
              >
                전체 {docs.length}개 보기
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 1b 셸의 '워크스페이스' 섹션. 폴더와 문서를 계층으로 보여준다. */
export function DocTree({ onNavigate }: { onNavigate?: () => void }) {
  const { docId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isPending, isError, refetch } = useTree()
  const createDoc = useCreateDoc()
  const createFolder = useCreateFolder()
  const renameFolder = useRenameFolder()
  const moveNode = useMoveNode()

  // data 는 react-query 캐시 객체라 그대로가 안정적인 참조다. `?? …`를 memo 밖에 두면
  // 매 렌더 새 객체가 되어 아래 memo가 전부 무효화된다.
  const empty = useMemo(() => ({ folders: [], docs: [] }), [])
  const tree = useMemo(() => buildTree(data ?? empty), [data, empty])
  const openPath = useMemo(() => new Set(ancestorsOf(docId, data ?? empty)), [docId, data, empty])

  /** 열려 있는 이름 입력창. 새 폴더는 부모 id 를, 이름 변경은 그 폴더를 들고 있다. */
  const [naming, setNaming] = useState<
    | { mode: 'create'; parentId: string | null }
    | { mode: 'rename'; id: string; title: string }
    | null
  >(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof ApiError ? err.message : fallback)
  // 이름 입력창은 아직 열려 있다. 고칠 곳이 그 안에 있으니 토스트가 아니라 입력 옆에 낸다.
  const failInline = (err: unknown, fallback: string) =>
    setNameError(err instanceof ApiError ? err.message : fallback)

  /** 끌고 있는 것과, 그것이 올라가 있는 놓을 자리(`data-drop` 값). */
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const toRoot = !!drag && !!data && canDrop(drag, null, data)

  /**
   * 옮긴다. 잘못 놓기 쉬운 조작이고 트리는 전원이 같이 보는 것이라 토스트에 되돌리기를 단다.
   *
   * 결과는 `mutate` 의 콜백이 아니라 약속으로 받는다. 트리는 문서를 열고 닫을 때 다시 마운트되는데
   * (위 `expandedIds`) 콜백은 그 뒤로 불리지 않아, 되돌리기가 실패해도 조용해진다.
   */
  const move = (item: DragItem, to: string | null) => {
    const moved =
      item.kind === 'doc'
        ? data?.docs.find((d) => d.id === item.id)
        : data?.folders.find((f) => f.id === item.id)
    if (!moved) return
    const from = 'folder_id' in moved ? moved.folder_id : moved.parent_id
    const dest = data?.folders.find((f) => f.id === to)?.title

    void moveNode.mutateAsync({ item, to }).then(
      () =>
        toast.success(`«${moved.title}» 를 ${dest ? `«${dest}» 폴더로` : '최상위로'} 옮겼습니다.`, {
          durationMs: 10_000,
          action: {
            label: '되돌리기',
            onClick: () =>
              void moveNode
                .mutateAsync({ item, to: from })
                .catch((err: unknown) => fail(err, '되돌리지 못했습니다.')),
          },
        }),
      (err: unknown) => fail(err, '옮기지 못했습니다.'),
    )
  }

  /** 포인터 아래의 놓을 자리. 놓을 수 없는 곳이면 null. */
  const zoneAt = (e: DragEvent): string | null => {
    if (!drag || !data || !(e.target instanceof Element)) return null
    const zone = e.target.closest<HTMLElement>('[data-drop]')?.dataset.drop
    return zone !== undefined && canDrop(drag, zone || null, data) ? zone : null
  }

  const endDrag = () => {
    setDrag(null)
    setOver(null)
  }

  /*
   * 끌기는 줄마다 달지 않고 여기 한 곳에서 받는다. 줄은 `data-drag`(끌 것)와 `data-drop`(놓을
   * 자리)만 단다. 문서·폴더 이름은 링크라 브라우저가 원래 끌 수 있게 해 준다.
   */
  const dragHandlers = {
    onDragStart: (e: DragEvent) => {
      // 마우스가 있는 기기에서만. 아이폰은 링크를 길게 누르면 끌기가 시작돼 스크롤과 부딪힌다.
      if (!window.matchMedia('(pointer: fine)').matches || !(e.target instanceof Element)) return
      const row = e.target.closest<HTMLElement>('[data-drag]')
      const id = row?.dataset.id
      if (!row || !id) return
      setDrag({ kind: row.dataset.drag === 'folder' ? 'folder' : 'doc', id })
      setDragCard(e, row)
    },
    onDragOver: (e: DragEvent) => {
      const zone = zoneAt(e)
      setOver(zone)
      if (zone === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
    },
    onDrop: (e: DragEvent) => {
      const zone = zoneAt(e)
      if (drag && zone !== null) {
        e.preventDefault()
        move(drag, zone || null)
      }
      endDrag()
    },
    onDragEnd: endDrag,
  }

  const actions: RowActions = {
    dragId: drag?.id ?? null,
    over,
    onNavigate,
    onAddDoc: (folderId) =>
      createDoc.mutate(
        { folder_id: folderId },
        {
          onSuccess: (doc) => {
            onNavigate?.()
            void navigate(`/docs/${doc.id}`)
          },
          onError: (err) => fail(err, '문서를 만들지 못했습니다.'),
        },
      ),
    onAddFolder: (parentId) => {
      setNameError(null)
      setNaming({ mode: 'create', parentId })
    },
    onRename: (id, title) => {
      setNameError(null)
      setNaming({ mode: 'rename', id, title })
    },
  }

  const submitName = (value: string) => {
    if (!naming) return
    if (naming.mode === 'create') {
      createFolder.mutate(
        { title: value, parent_id: naming.parentId },
        {
          onSuccess: () => {
            setNaming(null)
            toast.success('폴더를 만들었습니다.')
          },
          onError: (err) => failInline(err, '폴더를 만들지 못했습니다.'),
        },
      )
      return
    }
    renameFolder.mutate(
      { id: naming.id, title: value },
      {
        onSuccess: () => {
          setNaming(null)
          toast.success('폴더 이름을 바꿨습니다.')
        },
        onError: (err) => failInline(err, '이름을 바꾸지 못했습니다.'),
      },
    )
  }

  if (isPending) {
    return (
      <div className="space-y-1.5 px-2 py-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface-hover h-5 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  return (
    <div {...dragHandlers}>
      {isError && !data && (
        <div className="space-y-1 px-3 py-2">
          <p className="text-danger text-xs">문서 트리를 불러오지 못했습니다.</p>
          <RetryButton onClick={refetch} />
        </div>
      )}
      {!isError && tree.length === 0 && (
        <p className="text-subtle px-3 py-2 text-xs">문서가 없습니다.</p>
      )}

      {tree.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow
            key={node.folder.id}
            node={node}
            depth={0}
            openPath={openPath}
            actions={actions}
          />
        ) : (
          <DocRow
            key={node.doc.id}
            node={node}
            depth={0}
            dragging={drag?.id === node.doc.id}
            onNavigate={onNavigate}
          />
        ),
      )}

      {/* 안쪽 폴더를 끄는 동안에는 최상위로 빼는 자리가 된다. 폴더 줄 사이에는 놓을 틈이 없다. */}
      <button
        type="button"
        data-drop={ROOT_DROP}
        onClick={() => actions.onAddFolder(null)}
        className={cn(
          'text-subtle hover:bg-surface-hover hover:text-fg mt-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
          over === ROOT_DROP && 'bg-accent-soft text-accent',
        )}
      >
        {toRoot ? (
          <>
            <CornerLeftUp className="size-3.5 shrink-0" />
            여기에 놓으면 최상위로
          </>
        ) : (
          <>
            <Plus className="size-3.5 shrink-0" />새 폴더
          </>
        )}
      </button>

      {naming && (
        <FolderNameModal
          title={naming.mode === 'create' ? '새 폴더' : '폴더 이름 변경'}
          initial={naming.mode === 'rename' ? naming.title : ''}
          submitLabel={naming.mode === 'create' ? '만들기' : '저장'}
          pending={createFolder.isPending || renameFolder.isPending}
          error={nameError}
          onDirty={() => setNameError(null)}
          onSubmit={submitName}
          onClose={() => setNaming(null)}
        />
      )}
    </div>
  )
}
