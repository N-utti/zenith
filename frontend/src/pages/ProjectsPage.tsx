import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/ToastContext'
import { useDeleteProject, useProjects } from '@/features/projects/api'
import { ProjectFormModal } from '@/features/projects/ProjectForms'
import { ProjectProgress } from '@/features/projects/ProjectProgress'
import { deleteProjectMessage, personName, type Project } from '@/features/projects/types'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useContextMenuAt } from '@/lib/useContextMenuAt'

/** 협업 공간의 첫 화면. 프로젝트마다 진행률을 보이고, 누르면 그 프로젝트의 칸반보드로 간다. */
export function ProjectsPage() {
  const toast = useToast()
  const projects = useProjects()
  const remove = useDeleteProject()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const items = projects.data?.items

  const removeProject = (project: Project) => {
    if (!confirm(deleteProjectMessage(project))) return
    remove.mutate(project.id, {
      onSuccess: () => toast.success('프로젝트를 지웠습니다.'),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : '지우지 못했습니다.'),
    })
  }

  return (
    <>
      <PageHeader
        title="협업 공간"
        description="사내 프로젝트의 업무를 단계별로 나눠 봅니다. 거래 안건은 CRM 에 둡니다."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />새 프로젝트
          </Button>
        }
      />
      {projects.isPending && <SkeletonRows rows={3} />}
      {projects.isError && !items && (
        <Card>
          <CardEmpty onRetry={projects.refetch}>프로젝트를 불러오지 못했습니다.</CardEmpty>
        </Card>
      )}
      {items?.length === 0 && (
        <Card>
          <CardEmpty>아직 프로젝트가 없습니다.</CardEmpty>
        </Card>
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={() => setEditing(project)}
              deleting={remove.isPending}
              onDelete={() => removeProject(project)}
            />
          ))}
        </ul>
      )}
      {creating && <ProjectFormModal onClose={() => setCreating(false)} />}
      {editing && <ProjectFormModal project={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/**
 * 프로젝트 카드. 우클릭(손가락 기기는 꾹 누르기)으로 열기·수정·삭제. 삭제는 서버가 지울 수 있다고 한
 * 사람(`can_delete`, 만든 사람과 임원)에게만 보인다. 보드 머리줄의 지우기 버튼과 같은 규칙이다.
 */
function ProjectCard({
  project,
  onEdit,
  deleting,
  onDelete,
}: {
  project: Project
  onEdit: () => void
  /** 앞 삭제가 도는 중. 끝나기 전에 또 지우면 404 알림이 뜬다. */
  deleting: boolean
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const menu = useContextMenuAt()
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        {...menu.triggers}
        className={cn(
          'border-line bg-surface hover:bg-surface-hover block h-full space-y-2 rounded-xl border p-4 transition-colors',
          'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]',
          // 어느 카드의 메뉴인지 보이게 메뉴가 떠 있는 동안 카드를 칠해 둔다.
          menu.at && 'bg-surface-hover',
        )}
      >
        <h2 className="text-fg text-sm font-semibold break-words">{project.name}</h2>
        {project.description && (
          <p className="text-muted line-clamp-2 text-xs break-words">{project.description}</p>
        )}
        <ProjectProgress project={project} />
        <p className="text-subtle text-xs">만든 사람 {personName(project.created_by)}</p>
      </Link>
      {/* 링크 밖에 둔다. 포털이어도 React 이벤트는 위로 올라가서, 링크 안에 두면 메뉴를 누를 때 프로젝트가 열린다. */}
      {menu.at && (
        <ContextMenu at={menu.at} label={`${project.name} 메뉴`} onClose={menu.close}>
          <ContextMenuItem
            icon={ArrowUpRight}
            label="열기"
            onSelect={() => void navigate(`/projects/${project.id}`)}
          />
          <ContextMenuItem icon={Pencil} label="수정" onSelect={onEdit} />
          {project.can_delete && (
            <ContextMenuItem
              icon={Trash2}
              label="삭제"
              danger
              disabledReason={deleting ? '지우는 중' : undefined}
              onSelect={onDelete}
            />
          )}
        </ContextMenu>
      )}
    </li>
  )
}
