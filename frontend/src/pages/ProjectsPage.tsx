import { useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardEmpty } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useProjects } from '@/features/projects/api'
import { ProjectFormModal } from '@/features/projects/ProjectForms'
import { ProjectProgress } from '@/features/projects/ProjectProgress'
import { personName } from '@/features/projects/types'

/** 협업 공간의 첫 화면. 프로젝트마다 진행률을 보이고, 누르면 그 프로젝트의 칸반보드로 간다. */
export function ProjectsPage() {
  const projects = useProjects()
  const [creating, setCreating] = useState(false)
  const items = projects.data?.items

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
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="border-line bg-surface hover:bg-surface-hover block h-full space-y-2 rounded-xl border p-4 transition-colors"
              >
                <h2 className="text-fg text-sm font-semibold break-words">{project.name}</h2>
                {project.description && (
                  <p className="text-muted line-clamp-2 text-xs break-words">
                    {project.description}
                  </p>
                )}
                <ProjectProgress project={project} />
                <p className="text-subtle text-xs">만든 사람 {personName(project.created_by)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <ProjectFormModal onClose={() => setCreating(false)} />}
    </>
  )
}
