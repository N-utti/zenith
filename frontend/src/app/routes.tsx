import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { Spinner } from '@/components/ui/Spinner'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { AiPage } from '@/pages/AiPage'
import { AttendancePage } from '@/pages/AttendancePage'
import { BoardPage } from '@/pages/BoardPage'
import { ChatPage } from '@/pages/ChatPage'
import { DocsPage } from '@/pages/DocsPage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SettingsPage } from '@/pages/SettingsPage'

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
        {/* 에디터는 화면을 꽉 채우고 영역별로 따로 스크롤한다. */}
        <Route element={<AppLayout bleed />}>
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
          <Route path="chat" element={<ChatPage />} />
          <Route path="board" element={<BoardPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="ai" element={<AiPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
