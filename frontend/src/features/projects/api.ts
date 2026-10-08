import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Project, ProjectInput, Task, TaskInput } from './types'

/** 업무를 옮기면 프로젝트의 완료 수도 바뀐다. 한 키 아래 두고 같이 다시 읽는다. */
const projectsKey = ['projects'] as const
const tasksKey = (projectId: string) => [...projectsKey, 'tasks', projectId] as const

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) })

export function useProjects() {
  return useQuery({
    queryKey: [...projectsKey, 'list'],
    queryFn: () => api<{ items: Project[] }>('/projects'),
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: [...projectsKey, 'one', id],
    queryFn: () => api<Project>(`/projects/${id}`),
    enabled: id.length > 0,
  })
}

export function useTasks(projectId: string) {
  return useQuery({
    queryKey: tasksKey(projectId),
    queryFn: () => api<{ items: Task[] }>(`/projects/${projectId}/tasks`),
    enabled: projectId.length > 0,
  })
}

function useRefetchProjects() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: projectsKey })
}

export function useCreateProject() {
  const refetch = useRefetchProjects()
  return useMutation({
    mutationFn: (input: ProjectInput) => api<Project>('/projects', json('POST', input)),
    onSuccess: refetch,
  })
}

export function useUpdateProject() {
  const refetch = useRefetchProjects()
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<ProjectInput> & { id: string }) =>
      api<Project>(`/projects/${id}`, json('PATCH', patch)),
    onSuccess: refetch,
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
    // 지운 프로젝트의 상세·업무는 다시 부르면 404 뿐이다. 그 둘은 다시 받지 않고 낡았다는 표시만
    // 남긴다(아직 그 화면이 떠 있다). 목록만 새로 읽는다.
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: [...projectsKey, 'one', id], refetchType: 'none' })
      void qc.invalidateQueries({ queryKey: tasksKey(id), refetchType: 'none' })
      return qc.invalidateQueries({ queryKey: [...projectsKey, 'list'] })
    },
  })
}

export function useCreateTask(projectId: string) {
  const refetch = useRefetchProjects()
  return useMutation({
    mutationFn: (input: TaskInput) =>
      api<Task>(`/projects/${projectId}/tasks`, json('POST', input)),
    onSuccess: refetch,
  })
}

/**
 * 업무 고치기와 단계 옮기기. 카드를 놓자마자 그 열에 있어야 해서 캐시를 먼저 고치고,
 * 실패하면 되돌린다.
 *
 * `onFail` 은 보드가 실패를 알릴 때 쓴다. `mutate` 에 넘기는 콜백은 연달아 부르면 마지막 것만
 * 돌아서, 카드 둘을 잇달아 옮기다 앞의 것이 실패하면 알림 없이 카드만 돌아간다.
 */
export function useUpdateTask(projectId: string, onFail?: (err: unknown) => void) {
  const qc = useQueryClient()
  const key = tasksKey(projectId)
  const mutationKey = [...projectsKey, 'update-task', projectId]
  const setStage = (id: string, stage: Task['stage']) =>
    qc.setQueryData<{ items: Task[] }>(
      key,
      (old) => old && { items: old.items.map((t) => (t.id === id ? { ...t, stage } : t)) },
    )
  return useMutation({
    mutationKey,
    mutationFn: ({ id, ...patch }: Partial<TaskInput> & { id: string }) =>
      api<Task>(`/project-tasks/${id}`, json('PATCH', patch)),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<{ items: Task[] }>(key)?.items.find((t) => t.id === id)
      // 먼저 고치는 것은 단계뿐이다. 담당자는 이름을 서버가 채워 준다.
      if (before && stage) setStage(id, stage)
      return { before: stage ? before?.stage : undefined }
    },
    // 그 업무의 단계만 되돌린다. 목록째 되돌리면 그사이 옮긴 다른 카드까지 옛 열로 간다.
    onError: (err, { id }, context) => {
      if (context?.before) setStage(id, context.before)
      onFail?.(err)
    },
    // 옮기는 요청이 더 남아 있으면 다시 읽지 않는다. 지금 읽으면 서버에는 뒤 카드가 아직 옛
    // 단계라, 먼저 고쳐 둔 화면을 덮어 카드가 원래 열로 튀었다 돌아온다.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) === 1) {
        return qc.invalidateQueries({ queryKey: projectsKey })
      }
    },
  })
}

export function useDeleteTask() {
  const refetch = useRefetchProjects()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/project-tasks/${id}`, { method: 'DELETE' }),
    onSuccess: refetch,
  })
}
