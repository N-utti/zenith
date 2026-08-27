import { Route, Routes } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
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
