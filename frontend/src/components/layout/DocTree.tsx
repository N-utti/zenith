import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Columns2,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { RetryButton } from '@/components/ui/Card'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { isDesktopShell } from '@/lib/desktop'
import { serverOrigin } from '@/lib/serverOrigin'
import { useLongPress } from '@/lib/useLongPress'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { FolderAccessModal } from '@/features/docs/FolderAccessModal'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { MoveNodeModal } from '@/features/docs/MoveNodeModal'
import { TrashDocModal } from '@/features/docs/TrashDocModal'
import { setSplitDoc } from '@/features/docs/splitDoc'
import { DOC_DRAG_TYPE } from '@/features/docs/types'
import {
  UNTITLED_DOC,
  useCreateDoc,
  useCreateFolder,
  useDeleteFolder,
  useMoveNode,
  useRenameDoc,
  useRenameFolder,
  useTree,
} from '@/features/docs/api'
import {
  ancestorsOf,
  buildTree,
  canDrop,
  folderAccessLabel,
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
 * 때와 똑같아서 옮기는 중인지 알 수 없다. 그 줄의 이름을 본뜬 카드를 붙인다(문서는 아이콘까지.
 * 폴더 아이콘은 펼치기 버튼 안에 있어 링크를 복제하면 따라오지 않는다).
 *
 * 그림은 dragstart 가 끝난 직후에 찍힌다. 화면 밖에 잠깐 붙였다가 다음 박자에 치운다.
 */
function setDragCard(e: DragEvent, row: HTMLElement) {
  const card = row.cloneNode(true) as HTMLElement
  card.className =
    'bg-surface text-fg border-accent fixed -top-96 left-0 flex max-w-60 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium'
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

/**
 * 트리의 한 줄. 노션 사이드바 규격이다: 28px 높이(손가락 기기는 32px), 14px 글자, 깊이와 상관없이
 * 줄 전체(화살표·조작 포함)가 하나의 알약으로 칠해진다. 들여쓰기는 알약 안쪽 여백으로만 주되,
 * 알약 안에 눌리지 않는 빈 칸이 생기지 않게 그 여백은 줄 div 가 아니라 맨 앞 링크·버튼이 갖는다.
 * 손가락 기기는 줄 어디를 꾹 눌러도 줄 메뉴가 뜬다. 사파리의 링크 미리보기·글자 선택이 겹쳐 뜨지
 * 않게 줄 전체에서 끈다.
 */
const ROW =
  'group/row flex items-center rounded-md text-sm transition-[background-color,color,opacity] pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'

/** 줄 안의 이름 링크. 세로 여백이 곧 줄 높이다. 손가락 기기는 꾹 누를 때 링크 끌기가 시작되지 않게 끈다. */
const ROW_LINK =
  'flex min-w-0 flex-1 items-center gap-1.5 py-1 pointer-coarse:py-1.5 pointer-coarse:[-webkit-user-drag:none]'

/** 줄의 색. 지금 화면이거나, 올려 뒀거나, 이 줄의 메뉴가 열려 있을 때. */
const rowTone = (active: boolean, menuOpen: boolean) =>
  active
    ? 'md:bg-accent-soft text-accent font-semibold' // 폰은 바탕 없이 글자색만(Sidebar 의 ROW_ACTIVE)
    : menuOpen
      ? 'bg-surface-hover text-fg'
      : 'text-muted hover:bg-surface-hover hover:text-fg'

/**
 * 줄 왼쪽 여백. 기본 8px 에 한 단계마다 14px. 28px 줄에서 계단이 보이는 비율이고, 기본값은 최상위
 * 문서 아이콘이 상단 메뉴 아이콘과 같은 세로줄(사이드바 왼쪽에서 18px)에 서는 값이다(Sidebar 의
 * 구획 제목 화살표도 여기에 맞춰 서 있다).
 */
const indent = (depth: number) => 8 + depth * 14

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
  const active = useParams().docId === id
  return (
    <div
      // 줄 어디서든 우클릭하면(손가락은 꾹 누르면) 이 줄의 메뉴가 뜬다(`data-row`). 끄는 것은 이름 링크다.
      // 꾹 누르는 동안 줄째 눌려 들어간다(`data-long-press`).
      data-row
      data-long-press
      className={cn(
        ROW,
        rowTone(active, actions.menuId === id),
        actions.dragId === id && 'opacity-40',
      )}
    >
      <NavLink
        to={`/docs/${id}`}
        onClick={actions.onNavigate}
        data-drag="doc"
        data-id={id}
        className={cn(ROW_LINK, 'pr-2.5')}
        style={{ paddingLeft: indent(depth) }}
      >
        {/* 아이콘은 글자보다 흐리게. 문서마다 같은 그림이라 글자만큼 진하면 줄마다 소음이 된다. */}
        <span className="text-subtle grid size-5 shrink-0 place-items-center">
          <FileText className="size-4" strokeWidth={2} />
        </span>
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
  const access = folderAccessLabel(node.folder)
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
      {/* 굵기는 줄에 둔다. 링크에 두면 지금 보는 폴더의 semibold 가 링크의 medium 에 가려진다. */}
      <div
        data-row
        data-long-press
        className={cn(ROW, 'font-medium', rowTone(current, actions.menuId === id))}
      >
        {/*
          앞자리 하나가 아이콘과 화살표를 겸한다(노션). 평소엔 폴더 아이콘, 줄에 마우스를 올리거나
          키보드 초점이 오면 화살표로 바뀐다. 터치 기기는 hover 가 없어 늘 화살표다.
          초점 조건은 `focus-within` 이 아니라 `has-focus-visible` 이다. 크롬 계열은 마우스로 누른
          버튼·링크에도 초점을 주는데, 그걸로 켜면 누른 줄의 화살표와 조작이 마우스를 치운 뒤에도 남는다.
          폴더 이름이 이동 링크가 되어 펼치기는 이 버튼만 한다. 들여쓰기 여백도 이 버튼이 갖는다
          (`box-content` 라 20px 칸에 여백이 더해진다). 그 빈 칸을 눌러도 펼쳐진다.
        */}
        <button
          type="button"
          onClick={toggle}
          aria-label={`${title} ${expanded ? '접기' : '펼치기'}`}
          aria-expanded={expanded}
          className="text-subtle hover:text-fg grid w-5 shrink-0 cursor-pointer place-items-center box-content self-stretch transition-colors"
          style={{ paddingLeft: indent(depth) }}
        >
          <Icon
            className="size-4 group-has-focus-visible/row:hidden group-hover/row:hidden pointer-coarse:hidden"
            strokeWidth={2}
          />
          {expanded ? (
            <ChevronDown className="hidden size-3.5 group-has-focus-visible/row:block group-hover/row:block pointer-coarse:block" />
          ) : (
            <ChevronRight className="hidden size-3.5 group-has-focus-visible/row:block group-hover/row:block pointer-coarse:block" />
          )}
        </button>

        {/* 이름은 폴더 목록 화면으로 간다(노션과 같이). 펼치고 접기는 앞의 버튼이 맡는다. */}
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
          className={cn(ROW_LINK, 'px-1.5')}
        >
          <span className="truncate">{title}</span>
          {access && (
            <Lock role="img" aria-label={access} className="text-subtle size-3.5 shrink-0">
              <title>{access}</title>
            </Lock>
          )}
        </Link>

        {/*
          폴더 행에만 붙는 조작. 마우스를 올렸을 때와 키보드 초점이 왔을 때 보인다(위 버튼과 같은 조건).
          `opacity-0` 은 보이지만 않을 뿐 초점을 받으므로 Tab 으로도 닿는다.
          터치 기기에는 hover 가 없어 아예 뺀다. 같은 일은 줄을 꾹 누른 메뉴가 한다. 투명하게만 두면
          버튼이 행 오른쪽 탭을 가로채 모르는 새 문서가 생긴다.
        */}
        <div className="flex shrink-0 pr-1 opacity-0 transition-opacity group-has-focus-visible/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:hidden">
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
            <div className={cn(ROW, 'text-subtle hover:bg-surface-hover hover:text-fg')}>
              <Link
                to={`/docs?folder=${id}`}
                onClick={actions.onNavigate}
                aria-label={`${title} 전체 ${docs.length}개 보기`}
                className={cn(ROW_LINK, 'pr-2.5')}
                style={{ paddingLeft: indent(depth + 1) }}
              >
                {/* 문서 줄의 아이콘 자리만큼 비워 글자를 같은 세로줄에 세운다. */}
                <span className="size-5 shrink-0" />
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
  const renameDoc = useRenameDoc()
  const deleteFolder = useDeleteFolder()
  const moveNode = useMoveNode()

  // data 는 react-query 캐시 객체라 그대로가 안정적인 참조다. `?? …`를 memo 밖에 두면
  // 매 렌더 새 객체가 되어 아래 memo가 전부 무효화된다.
  const empty = useMemo(() => ({ folders: [], docs: [] }), [])
  const tree = useMemo(() => buildTree(data ?? empty), [data, empty])
  const openPath = useMemo(() => new Set(ancestorsOf(docId, data ?? empty)), [docId, data, empty])

  /** 열려 있는 이름 입력창. 새 폴더는 부모 id 를, 이름 변경은 그 폴더나 문서를 들고 있다. */
  const [naming, setNaming] = useState<
    | { mode: 'create'; parentId: string | null }
    | { mode: 'rename'; id: string; title: string }
    | { mode: 'rename-doc'; id: string; title: string }
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
  // 열람 권한 창을 연 폴더 id(백엔드 #421). 임원만 메뉴가 보인다. 실제 차단은 서버 403.
  const [accessId, setAccessId] = useState<string | null>(null)
  const isExec = useCurrentUser().role === 'exec'
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
    // 제목 뒤에 「문서」「폴더」를 붙여 쓴다. 제목에 바로 조사를 붙이면 받침에 따라 을·를이 갈린다.
    const what = `${moved.title} ${item.kind === 'doc' ? '문서' : '폴더'}`

    void moveNode.mutateAsync({ item, to }).then(
      () =>
        toast.success(`${what}를 ${dest ? `${dest} 폴더로` : '최상위로'} 옮겼습니다.`, {
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
      if (row.dataset.drag === 'doc') e.dataTransfer.setData(DOC_DRAG_TYPE, id)
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

  /** `target` 이 든 줄의 메뉴를 (x, y) 에 띄운다. 줄이 아니면 false. */
  const openMenuAt = (target: Element, x: number, y: number) => {
    const link = target.closest('[data-row]')?.querySelector<HTMLAnchorElement>('a[data-drag]')
    const id = link?.dataset.id
    if (!link || !id) return false
    // 키보드로 열면 포인터 좌표가 없다. 그 줄 바로 아래에 띄운다.
    const rect = link.getBoundingClientRect()
    setMenu({
      item: { kind: link.dataset.drag === 'folder' ? 'folder' : 'doc', id },
      x: x || rect.left,
      y: y || rect.bottom,
      href: link.href,
    })
    return true
  }

  /** 줄 위에서 우클릭(또는 Shift+F10, 메뉴 키). 줄이 아닌 곳에서는 브라우저 메뉴를 그대로 둔다. */
  const openMenu = (e: MouseEvent) => {
    if (e.target instanceof Element && openMenuAt(e.target, e.clientX, e.clientY))
      e.preventDefault()
  }
  // 손가락 기기는 꾹 누르기로 같은 메뉴를 연다(폴더 줄의 버튼 셋을 대신한다).
  const longPress = useLongPress(openMenuAt)

  const copyLink = (id: string) =>
    // 받은 사람의 채팅·댓글에서 문서 제목 칩으로 바뀌는 주소(서버 주소 기준).
    void copyText(`${serverOrigin() || location.origin}/docs/${id}`).then(
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
    if (naming.mode === 'rename-doc') {
      renameDoc.mutate(
        { id: naming.id, title: value },
        {
          onSuccess: () => {
            setNaming(null)
            toast.success('문서 이름을 바꿨습니다.')
          },
          // 릴레이에 못 붙은 실패는 ApiError 가 아니다. 그 문구를 그대로 보여 준다.
          onError: (err) =>
            setNameError(err instanceof Error ? err.message : '이름을 바꾸지 못했습니다.'),
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

  /** 트리에 보이는 것 기준으로 그 폴더에 든 것이 있는가. */
  const folderHasChildren = (id: string) =>
    !!data &&
    (data.folders.some((f) => f.parent_id === id) || data.docs.some((d) => d.folder_id === id))

  // 약속으로 받는다(`move` 와 같은 이유). 트리가 다시 마운트되면 `mutate` 의 콜백은 불리지 않는다.
  const removeFolder = (id: string, title: string) => {
    // 응답이 오기 전에 같은 폴더를 또 지우면 둘째 요청이 404 로 떨어져 성공 뒤에 실패가 뜬다.
    if (deleteFolder.isPending) return
    void deleteFolder.mutateAsync(id).then(
      () => toast.success(`${title} 폴더를 지웠습니다.`),
      (err: unknown) => fail(err, '폴더를 지우지 못했습니다.'),
    )
  }

  const menuTarget = menu && find(menu.item)
  const movingTarget = moving && find(moving)
  // 대상이 트리에서 사라졌으면(다른 사람이 지웠거나 옮겼다) 닫는다. 상태를 남겨 두면 그것이 다시
  // 나타날 때 메뉴와 창이 옛 자리에 저절로 다시 뜬다.
  if (data && menu && !menuTarget) setMenu(null)
  if (data && moving && !movingTarget) setMoving(null)
  const accessFolder = accessId ? data?.folders.find((f) => f.id === accessId) : undefined
  if (data && accessId && !accessFolder) setAccessId(null)

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
    <div {...dragHandlers} {...longPress} onContextMenu={openMenu}>
      {isError && !data && (
        <div className="space-y-1 px-3 py-2">
          <p className="text-danger text-[13px]">문서 트리를 불러오지 못했습니다.</p>
          <RetryButton onClick={refetch} />
        </div>
      )}
      {!isError && tree.length === 0 && (
        <p className="text-subtle px-3 py-2 text-[13px]">문서가 없습니다.</p>
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
          ROW,
          ROW_LINK,
          'text-subtle hover:bg-surface-hover hover:text-fg mt-0.5 w-full cursor-pointer pr-2.5 pl-2',
          over === ROOT_DROP && 'bg-accent-soft text-accent',
        )}
      >
        {/* 아이콘 자리를 문서 줄과 같은 20px 로 맞춰 글자가 같은 세로줄에 선다. */}
        <span className="grid size-5 shrink-0 place-items-center">
          {toRoot ? <CornerLeftUp className="size-3.5" /> : <Plus className="size-3.5" />}
        </span>
        {toRoot ? '여기에 놓으면 최상위로' : '새 폴더'}
      </button>

      {naming && (
        <FolderNameModal
          title={
            naming.mode === 'create'
              ? '새 폴더'
              : naming.mode === 'rename'
                ? '폴더 이름 변경'
                : '문서 이름 변경'
          }
          initial={naming.mode === 'create' ? '' : naming.title}
          submitLabel={naming.mode === 'create' ? '만들기' : '저장'}
          pending={createFolder.isPending || renameFolder.isPending || renameDoc.isPending}
          {...(naming.mode === 'rename-doc' && {
            label: '문서 이름',
            placeholder: '예: 주간 보고',
          })}
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
              {isExec && (
                <ContextMenuItem
                  icon={Lock}
                  label="열람 권한"
                  onSelect={() => setAccessId(menu.item.id)}
                />
              )}
              <hr className="border-line my-1" />
              {/* 빈 폴더만 지운다. 안에 든 것이 있으면 흐리게 두고 이유를 적는다. 휴지통에 든
                  문서는 트리에 없어 여기서는 모른다. 그 경우는 서버가 거절하고 이유를 준다. */}
              <ContextMenuItem
                icon={Trash2}
                label="폴더 지우기"
                danger
                disabledReason={
                  folderHasChildren(menu.item.id) ? '안에 문서나 폴더가 있습니다' : undefined
                }
                onSelect={() => removeFolder(menu.item.id, menuTarget.title)}
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
              {/* 끌어 놓기와 같은 일. 키보드(Shift+F10)로도 화면을 나눌 수 있게. 오른쪽 칸이 뜨는 폭(1280px)에서만. */}
              {window.matchMedia('(min-width: 80rem)').matches && (
                <ContextMenuItem
                  icon={Columns2}
                  label="오른쪽에 열기"
                  onSelect={() => setSplitDoc(menu.item.id)}
                />
              )}
              <ContextMenuItem
                icon={Link2}
                label="링크 복사"
                onSelect={() => copyLink(menu.item.id)}
              />
              {/* 제목 없는 문서는 빈 칸으로 연다. 기본 문구를 지우고 치게 하지 않는다. */}
              <ContextMenuItem
                icon={Pencil}
                label="이름 변경"
                onSelect={() => {
                  setNameError(null)
                  setNaming({
                    mode: 'rename-doc',
                    id: menu.item.id,
                    title: menuTarget.title === UNTITLED_DOC ? '' : menuTarget.title,
                  })
                }}
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

      {accessFolder && (
        <FolderAccessModal folder={accessFolder} onClose={() => setAccessId(null)} />
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
