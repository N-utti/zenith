import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { RetryButton } from '@/components/ui/Card'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { isDesktopShell } from '@/lib/desktop'
import { serverOrigin } from '@/lib/serverOrigin'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { MoveNodeModal } from '@/features/docs/MoveNodeModal'
import { TrashDocModal } from '@/features/docs/TrashDocModal'
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
  type TreeItem,
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

/**
 * 트리에서 시작한 끌기라는 표식. 끌던 줄이 도중에 사라지면(트리가 다시 불릴 때) 끝났다는 신호가
 * 오지 않아 「끌고 있는 것」이 남는데, 그 뒤 밖에서 끌어 온 파일·링크를 그것으로 착각하지 않게 한다.
 */
const DRAG_TYPE = 'application/x-zenith-tree'

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
  /** 우클릭 메뉴가 열려 있는 문서·폴더의 id. 어느 줄의 메뉴인지 보이게 그 줄을 칠해 둔다. */
  menuId: string | null
  onNavigate?: () => void
  onAddDoc: (folderId: string) => void
  onAddFolder: (parentId: string | null) => void
  onRename: (folderId: string, title: string) => void
}

/** 줄의 이름 링크. 지금 화면이거나, 올려 뒀거나, 이 줄의 메뉴가 열려 있을 때의 색. */
const rowLink = (active: boolean, menuOpen: boolean) =>
  active
    ? 'bg-accent-soft text-accent font-semibold'
    : menuOpen
      ? 'bg-surface-hover text-fg'
      : 'text-muted hover:bg-surface-hover hover:text-fg'

function DocRow({
  node,
  depth,
  actions,
}: {
  node: TreeNode & { kind: 'doc' }
  depth: number
  actions: RowActions
}) {
  const { id } = node.doc
  return (
    <div
      // 줄 어디서든 우클릭하면 이 줄의 메뉴가 뜬다(`data-row`). 끄는 것은 이름 링크다.
      data-row
      className={cn('flex items-center transition-opacity', actions.dragId === id && 'opacity-40')}
    >
      <span className="size-5 shrink-0" style={{ marginLeft: depth * 14 }} />
      <NavLink
        to={`/docs/${id}`}
        onClick={actions.onNavigate}
        data-drag="doc"
        data-id={id}
        className={({ isActive }) =>
          cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
            rowLink(isActive, actions.menuId === id),
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
      <div data-row className="group/row flex items-center">
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
            rowLink(current, actions.menuId === id),
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
            <DocRow key={doc.id} node={{ kind: 'doc', doc }} depth={depth + 1} actions={actions} />
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
  const [drag, setDrag] = useState<TreeItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const toRoot = !!drag && !!data && canDrop(drag, null, data)

  /** 우클릭 메뉴가 열린 줄과 자리. `href` 는 그 줄 링크의 주소(새 탭으로 열 때 쓴다). */
  const [menu, setMenu] = useState<{ item: TreeItem; x: number; y: number; href: string } | null>(
    null,
  )
  /** 메뉴에서 고른 뒤 열리는 대화상자. 옮길 폴더 고르기와 휴지통 확인. */
  const [moving, setMoving] = useState<TreeItem | null>(null)
  const [trashing, setTrashing] = useState<{ id: string; title: string } | null>(null)

  /** 지금 트리에서 그 문서·폴더. 그사이 지워졌거나 옮겨져 사라졌으면 없다. */
  const find = (item: TreeItem) =>
    item.kind === 'doc'
      ? data?.docs.find((d) => d.id === item.id)
      : data?.folders.find((f) => f.id === item.id)

  /**
   * 옮긴다. 잘못 놓기 쉬운 조작이고 트리는 전원이 같이 보는 것이라 토스트에 되돌리기를 단다.
   *
   * 결과는 `mutate` 의 콜백이 아니라 약속으로 받는다. 트리는 문서를 열고 닫을 때 다시 마운트되는데
   * (위 `expandedIds`) 콜백은 그 뒤로 불리지 않아, 되돌리기가 실패해도 조용해진다.
   */
  const move = (item: TreeItem, to: string | null) => {
    const moved = find(item)
    // 앞 이동의 응답이 오기 전에는 트리가 아직 옛 모습이다. 그때 또 옮기면 되돌릴 자리를 틀리게 읽는다.
    if (!moved || moveNode.isPending) return
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
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return null
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
      // 앞 이동이 끝나기 전에는 끌기도 시작하지 않는다(`move` 의 가드와 같은 이유).
      if (moveNode.isPending) return e.preventDefault()
      setDrag({ kind: row.dataset.drag === 'folder' ? 'folder' : 'doc', id })
      e.dataTransfer.setData(DRAG_TYPE, id)
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

  /** 줄 위에서 우클릭(또는 Shift+F10, 메뉴 키). 줄이 아닌 곳에서는 브라우저 메뉴를 그대로 둔다. */
  const openMenu = (e: MouseEvent) => {
    if (!(e.target instanceof Element)) return
    const link = e.target.closest('[data-row]')?.querySelector<HTMLAnchorElement>('a[data-drag]')
    const id = link?.dataset.id
    if (!link || !id) return
    e.preventDefault()
    // 키보드로 열면 포인터 좌표가 없다. 그 줄 바로 아래에 띄운다.
    const rect = link.getBoundingClientRect()
    setMenu({
      item: { kind: link.dataset.drag === 'folder' ? 'folder' : 'doc', id },
      x: e.clientX || rect.left,
      y: e.clientY || rect.bottom,
      href: link.href,
    })
  }

  // http(IP) 로 열면 navigator.clipboard 가 없어 바로 던진다. 그것도 실패 토스트로 받는다.
  const copyLink = (id: string) =>
    void Promise.resolve()
      // 받은 사람의 채팅·댓글에서 문서 제목 칩으로 바뀌는 주소(서버 주소 기준).
      .then(() => navigator.clipboard.writeText(`${serverOrigin() || location.origin}/docs/${id}`))
      .then(
        () => toast.success('문서 링크를 복사했습니다.'),
        () => toast.error('링크를 복사하지 못했습니다.'),
      )

  const actions: RowActions = {
    dragId: drag?.id ?? null,
    over,
    menuId: menu?.item.id ?? null,
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

  const menuTarget = menu && find(menu.item)
  const movingTarget = moving && find(moving)
  // 대상이 트리에서 사라졌으면(다른 사람이 지웠거나 옮겼다) 닫는다. 상태를 남겨 두면 그것이 다시
  // 나타날 때 메뉴와 창이 옛 자리에 저절로 다시 뜬다.
  if (data && menu && !menuTarget) setMenu(null)
  if (data && moving && !movingTarget) setMoving(null)

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
    <div {...dragHandlers} onContextMenu={openMenu}>
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
          <DocRow key={node.doc.id} node={node} depth={0} actions={actions} />
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

      {menu && menuTarget && (
        <ContextMenu at={menu} label={`${menuTarget.title} 메뉴`} onClose={() => setMenu(null)}>
          {menu.item.kind === 'folder' ? (
            <>
              <ContextMenuItem
                icon={FilePlus2}
                label="새 문서"
                onSelect={() => actions.onAddDoc(menu.item.id)}
              />
              <ContextMenuItem
                icon={FolderPlus}
                label="새 폴더"
                onSelect={() => actions.onAddFolder(menu.item.id)}
              />
              <ContextMenuItem
                icon={Pencil}
                label="이름 변경"
                onSelect={() => actions.onRename(menu.item.id, menuTarget.title)}
              />
              <ContextMenuItem
                icon={FolderInput}
                label="다른 폴더로 옮기기"
                onSelect={() => setMoving(menu.item)}
              />
            </>
          ) : (
            <>
              {/* 브라우저 메뉴를 가렸으니 거기 있던 둘을 돌려준다. 데스크탑 셸에는 탭이 없다. */}
              {!isDesktopShell() && (
                <ContextMenuItem
                  icon={ExternalLink}
                  label="새 탭에서 열기"
                  onSelect={() => window.open(menu.href, '_blank', 'noopener')}
                />
              )}
              <ContextMenuItem
                icon={Link2}
                label="링크 복사"
                onSelect={() => copyLink(menu.item.id)}
              />
              <ContextMenuItem
                icon={FolderInput}
                label="다른 폴더로 옮기기"
                onSelect={() => setMoving(menu.item)}
              />
              <hr className="border-line my-1" />
              <ContextMenuItem
                icon={Trash2}
                label="휴지통으로"
                danger
                onSelect={() => setTrashing({ id: menu.item.id, title: menuTarget.title })}
              />
            </>
          )}
        </ContextMenu>
      )}

      {moving && movingTarget && data && (
        <MoveNodeModal
          item={moving}
          title={movingTarget.title}
          data={data}
          onPick={(to) => {
            setMoving(null)
            move(moving, to)
          }}
          onClose={() => setMoving(null)}
        />
      )}

      {trashing && (
        <TrashDocModal
          id={trashing.id}
          title={trashing.title}
          onClose={() => setTrashing(null)}
          // 지금 열어 둔 문서를 보냈으면 편집 화면의 휴지통 버튼과 같이 문서 목록으로 나간다.
          onTrashed={() => {
            if (trashing.id === docId) void navigate('/docs', { replace: true })
          }}
        />
      )}
    </div>
  )
}
