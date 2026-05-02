import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import ErrorBoundary from './components/ErrorBoundary'
import UpdateDialog from './components/UpdateDialog'
import ConvergeOverlay from './components/ConvergeOverlay'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useTheme } from './hooks/useTheme'
import { useBeforeQuit } from './hooks/useBeforeQuit'
import { useCloudEmptyCellsCleanup } from './hooks/useCloudEmptyCellsCleanup'
import { useCloudFoldersCleanup } from './hooks/useCloudFoldersCleanup'

export default function App() {
  useGlobalShortcut()
  useAuthBootstrap()
  useTheme()
  useBeforeQuit()
  useCloudEmptyCellsCleanup()
  useCloudFoldersCleanup()
  const { status, downloadAndInstall, dismiss } = useAppUpdate()

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/mandalart/:id" element={<EditorPage />} />
        </Routes>
        <UpdateDialog status={status} onInstall={downloadAndInstall} onDismiss={dismiss} />
        {/* マンダラート → カード収束アニメ用 overlay。route 切替で unmount しないよう
            Routes の隣に置く (アニメ中の DOM が遷移を跨いで保持される) */}
        <ConvergeOverlay />
      </HashRouter>
    </ErrorBoundary>
  )
}
