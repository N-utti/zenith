import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { CRM_ENABLED, PROJECTS_ENABLED } from '@/app/navigation'
import { AppLayout } from '@/components/layout/AppLayout'
import { Spinner } from '@/components/ui/Spinner'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { AdminPage } from '@/pages/AdminPage'
import { AiPage } from '@/pages/AiPage'
import { ApprovalDetailPage } from '@/pages/ApprovalDetailPage'
import { ApprovalNewPage } from '@/pages/ApprovalNewPage'
import { ApprovalsPage } from '@/pages/ApprovalsPage'
import { ArchivePage } from '@/pages/ArchivePage'
import { AttendancePage } from '@/pages/AttendancePage'
import { CalendarPage } from '@/pages/CalendarPage'
import { BoardPage } from '@/pages/BoardPage'
import { BoardPostPage } from '@/pages/BoardPostPage'
import { ChatSocketProvider } from '@/features/chat/ChatSocketProvider'
import { ChatPage } from '@/pages/ChatPage'
import { CrmBoardPage } from '@/pages/CrmBoardPage'
import { ProjectBoardPage } from '@/pages/ProjectBoardPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { CrmDealPage } from '@/pages/CrmDealPage'
import { CrmOrgPage } from '@/pages/CrmOrgPage'
import { CrmOrgsPage } from '@/pages/CrmOrgsPage'
import { DocsPage } from '@/pages/DocsPage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TrashPage } from '@/pages/TrashPage'

/**
 * TipTap + ProseMirror + Yjs는 전체 번들의 절반을 넘는다.
 * 문서를 열기 전에는 받지 않는다.
 */
const DocEditorPage = lazy(() =>
  import('@/pages/DocEditorPage').then((module) => ({ default: module.DocEditorPage })),
)

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        {/* 채팅 소켓은 AppLayout보다 위에 둔다. AppLayout은 bleed 유무로 두 벌이라
            화면을 옮길 때 다시 마운트되는데, 소켓은 끊기면 안 된다. */}
        <Route element={<ChatSocketProvider />}>
          {/* 에디터는 화면을 꽉 채우고 영역별로 따로 스크롤한다. */}
          <Route element={<AppLayout bleed />}>
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:channelId" element={<ChatPage />} />
            {/* AI도 좌패널·대화·근거 3분할이라 영역별로 따로 스크롤한다. */}
            <Route path="ai" element={<AiPage />} />
            <Route
              path="docs/:docId"
              element={
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center">
                      <Spinner className="size-6" />
                    </div>
                  }
                >
                  <DocEditorPage />
                </Suspense>
              }
            />
          </Route>

          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="docs" element={<DocsPage />} />
            {/* 편집기(`docs/:docId`)보다 먼저 잡힌다. 고정 조각이 매개변수보다 우선이다. */}
            <Route path="docs/trash" element={<TrashPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="board/:boardId" element={<BoardPage />} />
            <Route path="board/:boardId/:postId" element={<BoardPostPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="approvals/new" element={<ApprovalNewPage />} />
            <Route path="approvals/:approvalId" element={<ApprovalDetailPage />} />
            {/* CRM 은 v1.1. 운영 빌드에서는 라우트째 빠진다(navigation.ts `CRM_ENABLED`). */}
            {CRM_ENABLED && (
              <>
                <Route path="crm" element={<CrmBoardPage />} />
                <Route path="crm/deals/:dealId" element={<CrmDealPage />} />
                <Route path="crm/orgs" element={<CrmOrgsPage />} />
                <Route path="crm/orgs/:orgId" element={<CrmOrgPage />} />
              </>
            )}
            {/* 협업 공간은 실서버 확인 전이라 운영 빌드에서 라우트째 빠진다(navigation.ts `PROJECTS_ENABLED`). */}
            {PROJECTS_ENABLED && (
              <>
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="projects/:projectId" element={<ProjectBoardPage />} />
              </>
            )}
            <Route path="archive" element={<ArchivePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            {/* 임원 전용. 화면이 등급을 보고 막고, 실제 차단은 서버 403 이다. */}
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
